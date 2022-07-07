//////////////////////////////////////////////////////////////////////
// plugin - Class containing the main logic for this plugin project //
//////////////////////////////////////////////////////////////////////

"use strict";

// NOTE: The "Text Expander JS" plugin uses a custom format for shortcut-files.  I tried using
// existing formats (json, xml, etc), but they were cumbersome for developing javascript code in.
// The chosen format is simple, flexible, and allows for wrapping scripts in js-fenced-code-blocks.
// This makes it easy to write Expansion scripts within Obsidian which is the intended use-case.
// For a summary of the format, see here:
// https://github.com/jon-heard/obsidian-text-expander-js#tutorial-create-a-new-shortcut-file
// and here:
// https://github.com/jon-heard/obsidian-text-expander-js#development-aid-fenced-code-blocks

// child_process is a node.js library, so is not available for mobile.  However, the code that uses
// it is blocked for mobile, so the plugin is still viable for mobile, just slightly more limited.
const childProcess = require("child_process");

class TextExpanderJsPlugin extends obsidian.Plugin
{
	public async onload(): Promise<void>
	{
		// Load settings
		const currentDefaultSettings: object =
			obsidian.Platform.isMobile ?
			Object.assign({}, DEFAULT_SETTINGS, DEFAULT_SUB_SETTINGS_MOBILE) :
			DEFAULT_SETTINGS;
		this.settings = Object.assign({}, currentDefaultSettings, await this.loadData());

		// Now that settings are loaded, keep track of the suffix's finishing character
		this.suffixEndCharacter = this.settings.suffix.charAt(this.settings.suffix.length - 1);

		// Attach settings UI
		this.addSettingTab(new TextExpanderJsPluginSettings(this.app, this));

		// Initialize support objects
		ShortcutLoader.initialize(this);
		ShortcutExpander.initialize(this);
		UserNotifier.initialize(this);
		ExternalRunner.initialize(this);
		this.shortcutDfc = new Dfc(
			this, this.settings.shortcutFiles, ShortcutLoader.getFunction_setupShortcuts(),
			this.onShortcutFileDisabled.bind(this), true);
		this.shortcutDfc.setMonitorType(
			this.settings.devMode ? DfcMonitorType.OnTouch : DfcMonitorType.OnModify);

		//Setup bound verson of this function for persistant use
		this._cm5_handleExpansionTrigger = this.cm5_handleExpansionTrigger.bind(this);

		// Connect "code mirror 5" instances to this plugin to trigger expansions
		this.registerCodeMirror( (cm: any) => cm.on("keydown", this._cm5_handleExpansionTrigger) );

		// Setup "code mirror 6" editor extension management to trigger expansions
		this.registerEditorExtension([
			require("@codemirror/state").EditorState.transactionFilter.of(
				this.cm6_handleExpansionTrigger.bind(this))
		]);

		// Track shutdown scripts in loaded shortcut-files to be called when unloaded.
		this.shortcutFileShutdownScripts = {};

		// Log starting the plugin
		UserNotifier.run(
		{
			consoleMessage: "Loaded (" + this.manifest.version + ")",
			messageLevel: "info"
		});
	}

	public onunload(): void
	{
		// Shutdown the shortcutDfc
		this.shortcutDfc.destructor();

		// Call shutdown script on shortcut files
		for (const filename in this.shortcutFileShutdownScripts)
		{
			this.onShortcutFileDisabled(filename);
		}

		// Disconnect "code mirror 5" instances from this plugin
		this.app.workspace.iterateCodeMirrors(
			(cm: any) => cm.off("keydown", this._cm5_handleExpansionTrigger));

		// Log ending the plugin
		UserNotifier.run(
		{
			consoleMessage: "Unloaded (" + this.manifest.version + ")",
			messageLevel: "info"
		});
	}

	public saveSettings(): void
	{
		this.saveData(this.settings);
	}

///////////////////////////////////////////////////////////////////////////////////////////////////

	private settings: any;
	private suffixEndCharacter: string;
	private _cm5_handleExpansionTrigger: any;
	private shortcutDfc: Dfc;
	private shortcutFileShutdownScripts: any;

	// Call the given shortcut-file's shutdown script.
	// Note: This is called when shortcut-file is being disabled
	private onShortcutFileDisabled(filename: string): void
	{
		if (!this.shortcutFileShutdownScripts[filename]) { return; }
		ShortcutExpander.runExpansionScript(this.shortcutFileShutdownScripts[filename]);
		delete this.shortcutFileShutdownScripts[filename];
	}

	// CM5 callback for "keydown".  Used to kick off shortcut expansion attempt
	private cm5_handleExpansionTrigger(cm: any, keydown: KeyboardEvent): void
	{
		if ((event as any)?.key == this.suffixEndCharacter)
		{
			this.tryShortcutExpansion();
		}
	}

	// CM6 callback for editor events.  Used to kick off shortcut expansion attempt
	private cm6_handleExpansionTrigger(tr: any): any
	{
		// Only bother with key inputs that have changed the document
		if (!tr.isUserEvent("input.type") || !tr.docChanged) { return tr; }

		let shouldTryExpansion: boolean = false;

		// Iterate over each change made to the document
		tr.changes.iterChanges(
		(fromA: number, toA: number, fromB: number, toB: number, inserted: any) =>
		{
			// Only try expansion if the shortcut suffix's end character was hit
			if (inserted.text[0] == this.suffixEndCharacter)
			{
				shouldTryExpansion = true;
			}
		}, false);

		if (shouldTryExpansion)
		{
			this.tryShortcutExpansion();
		}

		return tr;
	}

	// Tries to get shortcut beneath caret and expand it.  setTimeout pauses for a frame to
	// give the calling event the opportunity to finish processing.  This is especially
	// important for CM5, as the typed key isn't in the editor at the time this is called.
	private tryShortcutExpansion(): void { setTimeout(() =>
	{
		const editor: any  = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.editor;
		if (!editor) { return; }

		// Find bounds of the shortcut beneath the caret (if there is one)
		const cursor: any = editor.getCursor();
		const lineText: string = editor.getLine(cursor.line);
		const prefixIndex: number = lineText.lastIndexOf(this.settings.prefix, cursor.ch);
		const suffixIndex: number = lineText.indexOf(
			this.settings.suffix, prefixIndex + this.settings.prefix.length);

		// If the caret is not at a shortcut, early out
		if (prefixIndex == -1 || suffixIndex == -1 ||
		    (suffixIndex + this.settings.suffix.length) < cursor.ch)
		{
			return;
		}

		// Run the Expansion script on the shortcut under the caret
		const sourceText: string =
			lineText.substring(prefixIndex + this.settings.prefix.length, suffixIndex);
		let expansionText: string = ShortcutExpander.expand(sourceText, true);
		if (expansionText === undefined) { return; }

		// Handle a string array from the Expansion result
		if (Array.isArray(expansionText))
		{
			expansionText = expansionText.join("");
		}

		// Make sure we have a proper string
		expansionText = expansionText + "";

		// Replace written shortcut with Expansion result
		editor.replaceRange(
			expansionText,
			{ line: cursor.line, ch: prefixIndex },
			{ line: cursor.line, ch: suffixIndex + this.settings.suffix.length } );
	}, 0); }
}

module.exports = TextExpanderJsPlugin;