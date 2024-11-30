A VSCode extension designed to intelligently extract TypeScript/JavaScript code snippets along with their dependencies, optimized for sharing with Claude AI Assistant.

Features
Extracts the current file's content along with relevant imported entities
Intelligently processes TypeScript and JavaScript files
Follows imports one level deep to include dependent code
Automatic clipboard copying of extracted code
Support for various import types:
Default imports
Named imports
Namespace imports
Usage
Open a TypeScript/JavaScript file in VSCode
Run the "PBCode: Copy Current File with Dependencies" command (Cmd+Shift+C on macOS, Ctrl+Shift+C on Windows/Linux)
The extension will:
Copy the current file's content
Extract only the used entities from imported files
Copy everything to your clipboard
Show a notification with the number of files processed
How It Works
PBCode analyzes your current file and:

Identifies all import statements
Resolves import paths to actual files
Extracts only the specific classes, functions, interfaces, and types that are imported
Combines all relevant code into a single snippet optimized for sharing with Claude
Requirements
VSCode 1.95.0 or higher
TypeScript/JavaScript files in your workspace
Valid import statements in your code
Extension Settings
Currently, this extension doesn't require any configuration. Future versions may include settings for:

Maximum import depth
File type inclusion/exclusion
Output formatting preferences
Known Issues
Only follows imports one level deep (deeper import following planned for future releases)
Currently only supports TypeScript/JavaScript files
Requires files to be part of a VSCode workspace
