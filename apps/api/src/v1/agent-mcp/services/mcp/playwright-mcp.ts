import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import dedent from 'dedent';

import { IMcpServerConfig } from '../../agent-mcp.types';
import { BaseMcp } from '../base-mcp';

export interface PlaywrightMcpConfig {}

@Injectable({ scope: Scope.TRANSIENT })
export class PlaywrightMcp extends BaseMcp<PlaywrightMcpConfig> {
  constructor(logger: DefaultLogger) {
    super(logger);
  }

  public getMcpConfig(_config: PlaywrightMcpConfig): IMcpServerConfig {
    return {
      name: 'playwright',
      'command': 'docker',
      'args': ['run', '--rm', '-i', 'mcr.microsoft.com/playwright/mcp'],
    };
  }

  protected getInitTimeoutMs(): number {
    return 600_000; // 10 minutes
  }

  public getDetailedInstructions(_config: PlaywrightMcpConfig): string {
    return dedent`
      ### Playwright MCP (@playwright/mcp)

      Browser automation server for web scraping, testing, and interaction.
      Uses Playwright's accessibility tree for efficient, deterministic operations.

      **IMPORTANT: Docker Container Environment**
      Playwright runs inside a separate Docker container. This means:
      - **No Local File Access:** Any files produced by Playwright (screenshots, downloads, etc.) are NOT accessible locally
      - **Output Only:** You can only rely on stdout/stderr output from Playwright commands
      - **Isolated Filesystem:** The Playwright container has its own isolated filesystem that cannot be accessed from the host
      - **Cannot Retrieve Files:** Do not expect to find or access files that Playwright generates - they remain inside the container

      **When to Use:**
      - Web scraping and data extraction
      - Testing web applications
      - Automating repetitive browser tasks
      - Accessibility testing
      - Visual regression testing
      - Interacting with dynamic web pages

      **When NOT to Use:**
      - Static file operations (use filesystem tools)
      - API testing (use HTTP tools)
      - Local file system access (use filesystem MCP)
      - Tasks requiring file retrieval (screenshots, downloads) - files stay in container

      **Best Practices:**

      1. **Navigation First:**
         Always navigate to a page before interacting with it.

      2. **Wait for Elements:**
         Use \`playwright_wait_for_selector\` for dynamic content.

      3. **Accessibility-Based Selectors:**
         Prefer selectors using text, labels, or ARIA attributes:
         - \`button:text('Submit')\`
         - \`input[aria-label='Email']\`
         - \`[role='navigation']\`

      4. **Error Handling:**
         Handle navigation failures, missing elements, and timeouts gracefully.

      5. **Resource Management:**
         Browser contexts are automatically managed up to the configured limit.

      **Common Workflows:**

      \`\`\`
      # Basic scraping
      playwright_navigate({url: "https://example.com"})
      playwright_wait_for_selector({selector: ".content"})
      playwright_extract({selector: "h1", attribute: "textContent"})

      # Form submission
      playwright_navigate({url: "https://example.com/form"})
      playwright_fill({selector: "input[name='email']", value: "user@example.com"})
      playwright_fill({selector: "input[name='password']", value: "secret"})
      playwright_click({selector: "button:text('Sign In')"})

      # Visual testing (note: screenshots stay in container, not accessible locally)
      playwright_navigate({url: "https://example.com"})
      playwright_wait_for_selector({selector: ".main-content", state: "visible"})
      playwright_screenshot({fullPage: true})  # File stays in container
      \`\`\`

      **Security Considerations:**
      - Browser runs in isolated container environment
      - JavaScript evaluation is sandboxed to browser context
      - Network access is controlled by runtime environment
      - Always validate and sanitize URLs before navigation
    `;
  }
}
