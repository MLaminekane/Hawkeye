import { Command } from 'commander';
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

const DEFAULT_CONFIG = `# Hawkeye Configuration
# Documentation: https://github.com/hawkeye/hawkeye

drift:
  enabled: true
  check_every: 5
  provider: "ollama"
  model: "llama3.2"
  thresholds:
    warning: 60
    critical: 30
  context_window: 10
  auto_pause: false

guardrails:
  enabled: true
  rules:
    - name: "protected_files"
      type: "file_protect"
      paths:
        - ".env"
        - ".env.*"
        - "*.pem"
        - "*.key"
      action: "block"

    - name: "dangerous_commands"
      type: "command_block"
      patterns:
        - "rm -rf /"
        - "rm -rf ~"
        - "sudo rm"
        - "DROP TABLE"
      action: "block"

    - name: "cost_limit"
      type: "cost_limit"
      max_usd_per_session: 5.00
      max_usd_per_hour: 2.00
      action: "block"
`;

export const initCommand = new Command('init')
  .description('Initialize Hawkeye in the current project')
  .action(() => {
    const cwd = process.cwd();
    const hawkDir = join(cwd, '.hawkeye');
    const configPath = join(hawkDir, 'config.yaml');

    if (existsSync(hawkDir)) {
      console.log(chalk.yellow('⚠ .hawkeye/ already exists. Skipping.'));
      return;
    }

    // Create directory and config
    mkdirSync(hawkDir, { recursive: true });
    writeFileSync(configPath, DEFAULT_CONFIG, 'utf-8');

    // Add to .gitignore
    const gitignorePath = join(cwd, '.gitignore');
    const entry = '\n# Hawkeye\n.hawkeye/\n';

    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8');
      if (!content.includes('.hawkeye')) {
        appendFileSync(gitignorePath, entry);
        console.log(chalk.dim('  Added .hawkeye/ to .gitignore'));
      }
    } else {
      writeFileSync(gitignorePath, entry.trimStart(), 'utf-8');
      console.log(chalk.dim('  Created .gitignore'));
    }

    console.log(chalk.green('✓ Hawkeye initialized'));
    console.log(chalk.dim(`  Config: ${configPath}`));
    console.log('');
    console.log(
      `  Next: ${chalk.cyan('hawkeye record -o "your objective" -- <agent-command>')}`,
    );
  });
