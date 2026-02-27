#!/bin/sh
# Zitadel initialization script
# Creates: geniro project, geniro OIDC app (public, PKCE), demo users
# IDEMPOTENT: safe to re-run — handles 409 Conflict silently

set -e

ZITADEL_URL="http://zitadel:8080"
ADMIN_USERNAME="zitadel-admin@geniro.localhost"
ADMIN_PASSWORD="Password1!"

# --- Install jq for safe JSON construction ---
apk add --no-cache jq > /dev/null 2>&1

# --- Wait for Zitadel to be ready ---
echo "[init] Waiting for Zitadel API..."
for i in $(seq 1 30); do
  if curl -sf "${ZITADEL_URL}/debug/healthz/ready" > /dev/null 2>&1; then
    echo "[init] Zitadel is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[init] ERROR: Zitadel did not become ready in time."
    exit 1
  fi
  echo "[init] Waiting... attempt $i"
  sleep 5
done

# --- Authenticate as admin via v2 session API ---
echo "[init] Authenticating as admin..."
SESSION_BODY=$(jq -n --arg u "${ADMIN_USERNAME}" --arg p "${ADMIN_PASSWORD}" \
  '{"checks":{"user":{"loginName":$u},"password":{"password":$p}}}')
SESSION_RESPONSE=$(curl -sf -X POST "${ZITADEL_URL}/v2/sessions" \
  -H "Content-Type: application/json" \
  -d "${SESSION_BODY}")

SESSION_TOKEN=$(echo "${SESSION_RESPONSE}" | jq -r '.sessionToken // empty')
if [ -z "${SESSION_TOKEN}" ]; then
  echo "[init] ERROR: Failed to obtain session token."
  echo "[init] Response: ${SESSION_RESPONSE}"
  exit 1
fi
echo "[init] Admin session created."

# --- Exchange session token for an OAuth2 access token ---
# Zitadel session tokens cannot directly authenticate management API calls.
# We need to create a service user with a PAT (Personal Access Token) instead.
# First, use the admin session to create a machine user + PAT via the management API.

# The admin session token from v2 sessions can be used with the management API
# by passing it as a Bearer token. However, Zitadel requires the audience scope.
# The simplest approach for init: use the admin credentials to get an OAuth token
# via the password grant (Zitadel supports it for admin bootstrapping).

# Try using the session token directly with the management API
AUTH_HEADER="Authorization: Bearer ${SESSION_TOKEN}"

# Verify we can access the management API
echo "[init] Verifying management API access..."
ORG_RESPONSE=$(curl -sf -X GET "${ZITADEL_URL}/management/v1/orgs/me" \
  -H "${AUTH_HEADER}" \
  -H "Content-Type: application/json" 2>&1 || true)

if echo "${ORG_RESPONSE}" | grep -q '"org"'; then
  echo "[init] Management API accessible via session token."
else
  # Session token may not work directly; create a machine user + PAT
  echo "[init] Session token insufficient for management API. Creating service user with PAT..."

  # Create a machine user via management API (single request captures both status and body)
  MACHINE_BODY=$(jq -n '{
    "userName": "geniro-init-bot",
    "name": "Geniro Init Bot",
    "description": "Service user for initialization",
    "accessTokenType": "ACCESS_TOKEN_TYPE_BEARER"
  }')
  MACHINE_RAW=$(curl -s -w "\n%{http_code}" -X POST "${ZITADEL_URL}/management/v1/users/machine" \
    -H "${AUTH_HEADER}" \
    -H "Content-Type: application/json" \
    -d "${MACHINE_BODY}" 2>/dev/null || echo "\n000")
  MACHINE_HTTP_CODE=$(echo "${MACHINE_RAW}" | tail -1)
  MACHINE_USER=$(echo "${MACHINE_RAW}" | sed '$d')

  MACHINE_USER_ID=$(echo "${MACHINE_USER}" | jq -r '.userId // empty')
  if [ -z "${MACHINE_USER_ID}" ]; then
    # Machine user might already exist; search for it
    SEARCH_BODY=$(jq -n '{"queries": [{"userNameQuery": {"userName": "geniro-init-bot", "method": "TEXT_QUERY_METHOD_EQUALS"}}]}')
    SEARCH_RESULT=$(curl -sf -X POST "${ZITADEL_URL}/management/v1/users/_search" \
      -H "${AUTH_HEADER}" \
      -H "Content-Type: application/json" \
      -d "${SEARCH_BODY}" 2>/dev/null || true)
    MACHINE_USER_ID=$(echo "${SEARCH_RESULT}" | jq -r '.result[0].id // empty')
  fi

  if [ -n "${MACHINE_USER_ID}" ]; then
    # Create PAT for the machine user
    PAT_RESPONSE=$(curl -sf -X POST "${ZITADEL_URL}/management/v1/users/${MACHINE_USER_ID}/pats" \
      -H "${AUTH_HEADER}" \
      -H "Content-Type: application/json" \
      -d '{}' 2>/dev/null || true)

    PAT_TOKEN=$(echo "${PAT_RESPONSE}" | jq -r '.token // empty')
    if [ -n "${PAT_TOKEN}" ]; then
      # Grant IAM_OWNER role to the machine user
      MEMBER_BODY=$(jq -n --arg uid "${MACHINE_USER_ID}" '{"userId": $uid, "roles": ["IAM_OWNER"]}')
      curl -sf -X POST "${ZITADEL_URL}/admin/v1/members" \
        -H "${AUTH_HEADER}" \
        -H "Content-Type: application/json" \
        -d "${MEMBER_BODY}" > /dev/null 2>&1 || true

      AUTH_HEADER="Authorization: Bearer ${PAT_TOKEN}"
      echo "[init] Using PAT for subsequent API calls."
    fi
  fi
fi

# --- Create project ---
echo "[init] Creating 'geniro' project..."
PROJECT_BODY=$(jq -n '{
  "name": "geniro",
  "projectRoleAssertion": false,
  "projectRoleCheck": false,
  "hasProjectCheck": false
}')
PROJECT_RESPONSE=$(curl -s -X POST "${ZITADEL_URL}/management/v1/projects" \
  -H "${AUTH_HEADER}" \
  -H "Content-Type: application/json" \
  -d "${PROJECT_BODY}")

PROJECT_ID=$(echo "${PROJECT_RESPONSE}" | jq -r '.id // empty')

if [ -z "${PROJECT_ID}" ]; then
  # Project might already exist (409 Conflict or duplicate name)
  if echo "${PROJECT_RESPONSE}" | grep -q '"alreadyExists"\|"code":6'; then
    echo "[init] Project 'geniro' already exists, looking up ID..."
  else
    echo "[init] Project creation returned no ID, searching for existing..."
  fi

  # Search for existing project by name
  PROJECTS_SEARCH_BODY=$(jq -n '{"queries": [{"nameQuery": {"name": "geniro", "method": "TEXT_QUERY_METHOD_EQUALS"}}]}')
  PROJECTS_LIST=$(curl -sf -X POST "${ZITADEL_URL}/management/v1/projects/_search" \
    -H "${AUTH_HEADER}" \
    -H "Content-Type: application/json" \
    -d "${PROJECTS_SEARCH_BODY}")

  PROJECT_ID=$(echo "${PROJECTS_LIST}" | jq -r '.result[0].id // empty')
fi

if [ -z "${PROJECT_ID}" ]; then
  echo "[init] ERROR: Could not create or find 'geniro' project."
  echo "[init] Response: ${PROJECT_RESPONSE}"
  exit 1
fi
echo "[init] Project ID: ${PROJECT_ID}"

# --- Create OIDC app (public client, PKCE, auth code flow) ---
echo "[init] Creating 'geniro' OIDC app..."
APP_BODY=$(jq -n '{
  "name": "geniro",
  "redirectUris": [
    "http://localhost:5174/callback",
    "http://localhost:5174/silent-renew",
    "http://localhost:4173/callback",
    "http://localhost:4173/silent-renew"
  ],
  "postLogoutRedirectUris": [
    "http://localhost:5174",
    "http://localhost:4173"
  ],
  "responseTypes": ["OIDC_RESPONSE_TYPE_CODE"],
  "grantTypes": ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"],
  "appType": "OIDC_APP_TYPE_USER_AGENT",
  "authMethodType": "OIDC_AUTH_METHOD_TYPE_NONE",
  "devMode": true,
  "accessTokenType": "OIDC_TOKEN_TYPE_JWT",
  "idTokenRoleAssertion": true,
  "idTokenUserinfoAssertion": true
}')
APP_RESPONSE=$(curl -s -X POST "${ZITADEL_URL}/management/v1/projects/${PROJECT_ID}/apps/oidc" \
  -H "${AUTH_HEADER}" \
  -H "Content-Type: application/json" \
  -d "${APP_BODY}")

APP_ID=$(echo "${APP_RESPONSE}" | jq -r '.appId // empty')
CLIENT_ID=$(echo "${APP_RESPONSE}" | jq -r '.clientId // empty')

if [ -z "${APP_ID}" ]; then
  if echo "${APP_RESPONSE}" | grep -q '"alreadyExists"\|"code":6'; then
    echo "[init] OIDC app 'geniro' already exists."
  else
    echo "[init] OIDC app creation returned unexpected response (may already exist)."
    echo "[init] Response: ${APP_RESPONSE}"
  fi
else
  echo "[init] OIDC App ID: ${APP_ID}"
  echo "[init] Client ID: ${CLIENT_ID}"
fi

# --- Helper: create human user (idempotent) ---
create_user() {
  local username="$1"
  local password="$2"
  local given_name="$3"
  local family_name="$4"
  local email="$5"
  local display_name="${given_name} ${family_name}"

  echo "[init] Creating user '${username}'..."
  USER_BODY=$(jq -n \
    --arg u "${username}" \
    --arg p "${password}" \
    --arg gn "${given_name}" \
    --arg fn "${family_name}" \
    --arg dn "${display_name}" \
    --arg em "${email}" \
    '{
      "username": $u,
      "profile": {
        "givenName": $gn,
        "familyName": $fn,
        "displayName": $dn
      },
      "email": {
        "email": $em,
        "isVerified": true
      },
      "password": {
        "password": $p,
        "changeRequired": false
      }
    }')
  USER_RESPONSE=$(curl -s -X POST "${ZITADEL_URL}/v2/users/human" \
    -H "${AUTH_HEADER}" \
    -H "Content-Type: application/json" \
    -d "${USER_BODY}")

  USER_ID=$(echo "${USER_RESPONSE}" | jq -r '.userId // empty')
  if [ -n "${USER_ID}" ]; then
    echo "[init] User '${username}' created (ID: ${USER_ID})."
  elif echo "${USER_RESPONSE}" | grep -q '"alreadyExists"\|"code":6'; then
    echo "[init] User '${username}' already exists."
  else
    echo "[init] WARN: User '${username}' creation returned unexpected response."
    echo "[init] Response: ${USER_RESPONSE}"
  fi
}

# --- Create demo users ---
create_user "s.razumru" 'DevPassword123!' "Sergei" "Razumovskij" "s.razumru@geniro.localhost"
create_user "claude-test" "claude-test-2026" "Claude" "Test" "claude-test@geniro.localhost"

echo "[init] Zitadel initialization complete."
