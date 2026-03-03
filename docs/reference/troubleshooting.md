# Troubleshooting

## Common Issues

### Extension not activating

**Symptoms:** No diagnostics appear; status bar items are missing.

**Solutions:**
1. Check the VS Code Output panel (View > Output > Language Check) for error messages.
2. Ensure the active file is a supported type (Markdown, HTML, or LaTeX).
3. Run `Language Check: Check Current Document` from the Command Palette.

### Core binary not found

**Symptoms:** Error message about missing binary on activation.

**Solutions:**
1. Click **Download** when prompted to auto-download the binary.
2. Or download manually from [GitHub Releases](https://github.com/KaiErikNiermann/LangCheck/releases).
3. Set a custom path: `languageCheck.core.binaryPath` in VS Code settings.

### LanguageTool connection errors

**Symptoms:** Only Harper diagnostics appear; LT errors in output.

**Solutions:**
1. Start a local LanguageTool server: `docker compose up -d`
2. Verify the URL in config: `engines.languagetool_url`
3. Or disable LT: set `engines.languagetool: false`

### High memory usage

**Solutions:**
1. Enable High Performance Mode to disable LT and external providers.
2. Set `performance.max_file_size` to skip large files.
3. Add large directories to `exclude` patterns.

### SpeedFix panel is blank

**Solutions:**
1. Reload the VS Code window (`Ctrl+Shift+P` > Reload Window).
2. Check that the webview assets exist in the extension directory.

## Debug Tools

### Protobuf Trace

Enable message tracing to see all communication between the extension and core:

1. Run `Language Check: Toggle Protobuf Trace`
2. Run `Language Check: Show Protobuf Trace` to open the output channel
3. Check and fix a document to see traced messages

### Inspector Panel

Open the Inspector debug panel for advanced diagnostics:

1. Run `Language Check: Open Inspector`
2. View the AST structure, extracted prose ranges, and pipeline latency

### Core Channel Switching

Switch between different core binary builds:

1. Run `Language Check: Switch Core Binary`
2. Choose **Stable**, **Canary**, or **Dev**
3. Dev builds include debug symbols and verbose logging

## Reporting Issues

```{tip}
Including all of the items below helps us diagnose the problem faster.
```

1. VS Code version (`Help > About`)
2. Extension version (Extensions panel)
3. Core binary version (from output channel)
4. Protobuf trace output (see above)
5. Minimal reproduction file
