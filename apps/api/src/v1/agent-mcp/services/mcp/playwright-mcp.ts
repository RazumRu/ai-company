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
    const runtime = this.getRuntimeInstance();
    const sharedWorkdir = runtime?.getWorkdir() || '/runtime-workspace';

    return {
      name: 'playwright',
      'command': 'docker',
      'args': [
        'run',
        '--rm',
        '-i',
        '-v',
        `${sharedWorkdir}:${sharedWorkdir}`,
        '-v',
        `${sharedWorkdir}/playwright:/data`,
        'mcp/playwright',
      ],
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

      **IMPORTANT: Shared Runtime Volume**
      Playwright runs inside a Docker container, but a shared runtime volume is mounted:
      - **Shared Path:** \`/runtime-workspace\` is mounted into the Playwright container
      - **Shared Downloads:** \`/data\` maps to \`/runtime-workspace/playwright\`
      - **Retrievable Files:** Save downloads, screenshots, and artifacts under \`/data\` (preferred) or \`/runtime-workspace\`
      - **Agent Access:** Use the Filesystem MCP to read files from \`/runtime-workspace\`
      - **Outside Paths:** Files written outside \`/runtime-workspace\` stay in the Playwright container

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
      - Tasks that require saving files outside \`/runtime-workspace\`

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

      # Visual testing (save to shared /data)
      playwright_navigate({url: "https://example.com"})
      playwright_wait_for_selector({selector: ".main-content", state: "visible"})
      playwright_screenshot({fullPage: true, path: "/data/screenshots/home.png"})

      # Download handling (example: save into shared /data)
      # Always set downloadsDir/saveAs to /data when the tool supports it
      playwright_download({saveAs: "/data/downloads/report.csv"})
      \`\`\`

      **Retrieving Files**
      1. Save artifacts to \`/data/... \` (preferred) or \`/runtime-workspace/... \`.
      2. Use Filesystem MCP to list/read the file, e.g. \`read_text_file\` or \`read_media_file\`.
      3. If a tool supports \`downloadsDir\`, set it to \`/data\` so files are always accessible.

      **Security Considerations:**
      - Browser runs in isolated container environment
      - JavaScript evaluation is sandboxed to browser context
      - Network access is controlled by runtime environment
      - Always validate and sanitize URLs before navigation
    `;
  }
}
