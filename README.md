# Jasper Direct Print

A Chrome extension and Windows native helper that automatically prints PDF reports opened from Oracle APEX/JasperReports. It routes reports to different Windows printers based on URL rules, without showing Chrome's print dialog.

> **Platform:** Google Chrome (and compatible Chromium browsers) on Windows. The setup script also registers the native host for Microsoft Edge.

## Features

- Automatically detects matching Jasper report PDF tabs.
- Routes reports to different printers using ordered URL rules.
- Configures copies and optional report-tab closing per rule.
- Uses the browser's authenticated session cookies when fetching the PDF.
- Prints silently through SumatraPDF and a Windows native messaging host.
- Includes setup, diagnostics, and uninstall scripts.

## How it works

1. Your APEX application opens a JasperReports PDF URL in a browser tab.
2. The extension checks the URL against enabled rules, from top to bottom.
3. The extension sends the report URL and required session information to the local native messaging host.
4. The PowerShell helper downloads the PDF using the browser session and asks SumatraPDF to print it to the selected Windows printer.
5. The report tab is closed when that rule has tab closing enabled.

Chrome extensions cannot directly send jobs to arbitrary Windows USB/network printers. The native messaging host bridges the extension to the local Windows print system.

## Requirements

- Windows 10 or 11
- Google Chrome (or Microsoft Edge)
- Windows PowerShell 5.1
- A Windows-installed USB or network printer
- [SumatraPDF](https://www.sumatrapdfreader.org/download-free-pdf-viewer) installed, or its portable `SumatraPDF.exe` copied to `native-host/tools/`

SumatraPDF is not bundled in this repository. Download it from its official website and review its license and distribution terms.

## Installation

### 1. Download the project

Download this repository as a ZIP from GitHub and extract it to a permanent folder, for example:

```text
C:\Tools\jasper-direct-print
```

Do not delete or move the folder after setup; the native messaging registration points to files inside it (after the setup script copies the required files to your local application data folder).

### 2. Install SumatraPDF

Check the Install `SumatraPDF.exe` in the given location. If there is none then Install SumatraPDF normally, or place the portable executable here:

```text
native-host\tools\SumatraPDF.exe
```

### 3. Run setup

Double-click `Setup.bat`. If Windows blocks the script, open PowerShell in the extracted project folder and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1
```

The setup script copies the extension and native host into `%LOCALAPPDATA%\JasperDirectPrint`, registers the native messaging host for Chrome and Edge, and opens the extension folder.

### 4. Load the extension in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Choose the `extension` folder opened by the setup script (normally `%LOCALAPPDATA%\JasperDirectPrint\extension`).
5. Confirm that Chrome shows the expected extension ID: `nlbogiickdaofdblfkpkllloogcioghh`.
6. Restart Chrome if the native host is not detected.

For Microsoft Edge, use `edge://extensions` and load the same unpacked extension folder.

## Configure printing

1. Click the **Report Direct Print** extension icon.
2. Open **Settings**.
3. Use **Test native host** to confirm that the extension can communicate with the Windows helper.
4. Select **Refresh printers**.
5. Add one or more rules, choose a printer, and save.
6. Keep **Enable automatic printing** turned on.

### Rule matching

Rules are evaluated from top to bottom. The first enabled rule whose URL pattern matches the report URL is used. Put specific rules above broad fallback rules.

| Setting | Description |
| --- | --- |
| Rule enabled | Enables or disables an individual rule |
| URL pattern | URL substring or full `http(s)://` prefix to match |
| Printer | Installed Windows printer for the matching report |
| Copies | Number of copies to print |
| Close report tab | Closes the report tab after the print workflow |
| Close tab delay | Delay before closing the report tab |

Example:

| Order | URL pattern | Printer |
| --- | --- | --- |
| 1 | `_repName=OPD_3006_M_A4` | Front Desk Printer |
| 2 | `_repName=LAB_REPORT` | Lab Printer |
| 3 | `reports.example.com/jri/report` | Office Printer (fallback) |

Replace the example patterns with values from your own JasperReports URLs.

## Oracle APEX usage

No APEX code change is required if your application already opens the Jasper report URL in a new browser tab and the report is returned as PDF. Configure a rule that matches the report URL.

The original project was configured with a Jasper endpoint similar to:

```text
http://your-jasper-server:9092/jri/report?...&_repFormat=pdf...
```

Do not copy the original sample server IP into a production deployment. Configure the URL pattern for your own JasperReports server in the extension settings.

## Troubleshooting

### Native host not found

- Run `Setup.bat` again.
- Confirm the extension ID is `nlbogiickdaofdblfkpkllloogcioghh`.
- Restart the browser after setup.
- Run `Diagnose.bat` and review the output.

### SumatraPDF was not found

- Install SumatraPDF from its official website, or
- Copy the portable `SumatraPDF.exe` to `native-host/tools/` and run setup again.

### No printers appear

- Confirm the printer is installed under Windows **Settings → Bluetooth & devices → Printers & scanners**.
- Confirm Windows can print a test page.
- Reopen extension settings and refresh the printer list.

### A report opens but does not print

- Confirm the report URL returns a PDF and includes `_repFormat=pdf` where applicable.
- Confirm automatic printing is enabled.
- Check that an enabled URL rule matches the report URL.
- Confirm the selected printer is available in Windows.
- Review the browser console for messages prefixed with `[Jasper Direct Print]`.

### Authentication or session errors

The helper uses the browser session cookies when retrieving the PDF. Make sure you are signed in to the JasperReports server in the same browser profile and that the configured server is permitted by the extension's host permissions.

## Security and privacy

- The extension requests broad HTTP/HTTPS host access in its manifest so it can detect report tabs on different Jasper servers. Restrict `host_permissions` to your own server(s) where practical before deploying.
- The extension handles report URLs and session cookies to retrieve authenticated PDFs. Treat this data as sensitive.
- The settings-page password is configured separately on each installation and stored as a salted hash in local browser storage. It is only a casual-access deterrent, not a security boundary; anyone with access to the browser profile or extension developer tools can bypass it.
- The native host is registered for the extension ID embedded in the manifest key. Do not change or remove that key unless you also update the setup process and native host registration.
- PDFs are handled locally by the Windows helper. Review the PowerShell scripts before installing them in a managed or production environment.
- Do not commit report PDFs, credentials, cookies, private server addresses, or customer data to this repository.

Please report suspected vulnerabilities privately to the repository maintainer rather than opening a public issue containing sensitive details.

## Uninstall

1. Remove the extension from `chrome://extensions` (and/or `edge://extensions`).
2. Run `Uninstall.bat` from the project folder.
3. Confirm the `%LOCALAPPDATA%\JasperDirectPrint` folder and native messaging registry entries have been removed.

## Repository structure

```text
jasper-direct-print/
├── extension/                 # Chrome extension (Manifest V3)
│   ├── background.js
│   ├── manifest.json
│   ├── options.html
│   ├── options.js
│   ├── popup.html
│   ├── popup.js
│   └── icons/
├── native-host/               # Windows native messaging host
│   ├── com.jasper.directprint.json
│   ├── print_host.bat
│   ├── print_host.ps1
│   └── tools/                  # Place SumatraPDF.exe here if using portable version
├── Diagnose.bat
├── Diagnose.ps1
├── Setup.bat
├── Setup.ps1
├── Uninstall.bat
├── .gitignore
└── README.md
```

## Contributing

Bug reports and pull requests are welcome. Before submitting changes, test the extension and native host on a Windows machine with a test printer and a non-sensitive sample report.

## License

No project license has been specified yet. Contact the maintainer before redistributing or incorporating this project into another product.
