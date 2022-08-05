//////////////////////////////////////////////////////////////////////
// plugin - Class containing the main logic for this plugin project //
//////////////////////////////////////////////////////////////////////

"use strict";

import { Plugin, MarkdownView } from "obsidian";
import { UserNotifier } from "./ui_userNotifier";
import { InlineScriptsPluginSettings } from "./ui_settings";
import { DEFAULT_SETTINGS } from "./defaultSettings";
import { Dfc, DfcMonitorType } from "./Dfc";
import { ShortcutExpander } from "./ShortcutExpander";
import { ShortcutLoader } from "./ShortcutLoader";
import { AutoComplete } from "./AutoComplete";
import { InputBlocker } from "./ui_InputBlocker";
import { Popups } from "./ui_Popups";

// NOTE: The "Inline Scripts" plugin uses a custom format for shortcut-files.  I tried using
// existing formats (json, xml, etc), but they were cumbersome for developing JavaScript code in.
// The chosen format is simple, flexible, and allows for wrapping scripts in js-fenced-code-blocks.
// This makes it easy to write Expansion scripts within Obsidian which is the intended use-case.
// For a summary of the format, see here:
// https://github.com/jon-heard/obsidian-inline-scripts#tutorial-create-a-new-shortcut-file
// and here:
// https://github.com/jon-heard/obsidian-inline-scripts#development-aid-fenced-code-blocks

const ANNOUNCEMENT: string =
	"This is a major release for open-beta phase.\nIt has some great features!  However...\n A " +
	"few of the changes may be incompatible with existing shortcuts and/or shortcut-files.\n" +
	"<a href='https://github.com/jon-heard/obsidian-text-expander-js/discussions/22'>Please " +
	"check here for details</a>\n...including some simple steps to resolve any incompatibilities.";

export default class InlineScriptsPlugin extends Plugin
{
	// Store the plugin's settings
	public settings: any;
	// Keep track of the suffix's final character
	public suffixEndCharacter: string;
	// Keep track of shutdown scripts for any shortcut-files that have them
	public shutdownScripts: any = {};
	// Keep a Dfc for shortcut-files.  This lets us monitor changes to them.
	public shortcutDfc: Dfc;
	// The master list of shortcuts: all registered shortcuts.  Referenced during expansion.
	public shortcuts: Array<any>;
	// The instance of the settings panel UI
	public settingsUi: InlineScriptsPluginSettings;
	// The master list of shortcut syntaxes (provided by the About strings of all shortcuts)
	public syntaxes: Array<any>;
	// If set, all keyboard input is ignored
	public inputDisabled: boolean;

	public onload(): void
	{
		this.onload_internal();
	}

	public onunload(): void
	{
		this.onunload_internal();
	}

	public saveSettings(): void
	{
		this.saveData(this.settings);
	}

	// Returns an array of the addresses for all shortcut-files that are registered and enabled
	public getActiveShortcutFileAddresses(): Array<string>
	{
		return this.settings.shortcutFiles.filter((f: any) => f.enabled).map((f: any) => f.address);
	}

	public static getInstance(): InlineScriptsPlugin
	{
		return this._instance;
	}

	public static getDefaultSettings(): any
	{
		return Object.assign({}, DEFAULT_SETTINGS);
	}

	public tryShortcutExpansion(): void
	{
		this.tryShortcutExpansion_internal();
	}

///////////////////////////////////////////////////////////////////////////////////////////////////

	private _cm5_handleExpansionTrigger: any;
	private static _instance: InlineScriptsPlugin;

	private async onload_internal(): Promise<void>
	{
		// DEBUG aids
		//window.brk = function() { if (window.dbg) { debugger; } }
		//window.plugin = this;

		// Set this as THE instance
		InlineScriptsPlugin._instance = this;

		// Load settings
		this.settings = await this.loadData();
		if (this.settings && !this.settings.version) { this.settings.version = 0; }
		this.settings = Object.assign(InlineScriptsPlugin.getDefaultSettings(), this.settings);

		// Auto-convert old-style settings (because fixing this manually is a pain to the user)
		this.settings.shortcuts = this.settings.shortcuts.replaceAll("~~", "__");

		// Now that settings are loaded, update variable for the suffix's final character
		this.suffixEndCharacter = this.settings.suffix.charAt(this.settings.suffix.length - 1);

		// Attach settings UI
		this.settingsUi = new InlineScriptsPluginSettings(this);
		this.addSettingTab(this.settingsUi);

		// Attach autocomplete feature
		this.registerEditorSuggest(new AutoComplete(this));

		// Initialize support objects
		ShortcutExpander.initialize();
		this.shortcutDfc = new Dfc(
			this.getActiveShortcutFileAddresses(), ShortcutLoader.getFunction_setupShortcuts(),
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

		// Log that the plugin has loaded
		UserNotifier.run(
		{
			consoleMessage: "Loaded (" + this.manifest.version + ")",
			messageLevel: "info"
		});

		// Post a modal if the version was just updated
		if (this.settings.version != this.manifest.version)
		{
			this.settings.version = this.manifest.version;
			this.saveSettings();
			if (!ANNOUNCEMENT) { return; }
			Popups.getInstance().alert(
				"Inline Scripts\n(formerly Text Expander JS)\n" + this.manifest.version + "\n\n<div style='font-size: 75%'>" +
				ANNOUNCEMENT + "</div>");
		}
	}

	private onunload_internal(): void
	{
		// Shutdown the shortcutDfc
		this.shortcutDfc.destructor();

		// Call all shutdown scripts of shortcut-files
		for (const filename in this.shutdownScripts)
		{
			this.onShortcutFileDisabled(filename);
		}

		// Disconnect "code mirror 5" instances from this plugin
		this.app.workspace.iterateCodeMirrors(
			(cm: any) => cm.off("keydown", this._cm5_handleExpansionTrigger));

		// Log that the plugin has unloaded
		UserNotifier.run(
		{
			consoleMessage: "Unloaded (" + this.manifest.version + ")",
			messageLevel: "info"
		});
	}

	// Call the given shortcut-file's shutdown script.
	// Note: This is called when shortcut-file is being disabled
	private onShortcutFileDisabled(filename: string): void
	{
		if (!this.shutdownScripts[filename]) { return; }
		try
		{
			ShortcutExpander.runExpansionScript(
				this.shutdownScripts[filename], false, { shortcutText: "sfile shutdown" });
		}
		catch (e: any) {}
		delete this.shutdownScripts[filename];
	}

	// CM5 callback for "keydown".  Used to kick off shortcut expansion attempt.
	private cm5_handleExpansionTrigger(cm: any, keydown: KeyboardEvent): void
	{
		// Handle blocking key inputs when input is disabled
		if (this.inputDisabled)
		{
			event.preventDefault();
		}

		if ((event as any)?.key === this.suffixEndCharacter)
		{
			this.tryShortcutExpansion();
		}
	}

	// CM6 callback for editor events.  Used to kick off shortcut expansion attempt.
	private cm6_handleExpansionTrigger(tr: any): any
	{
		// Handle blocking key inputs when input is disabled
		if (this.inputDisabled)
		{
			return null;
		}

		// Only bother with key inputs that have changed the document
		if (!tr.isUserEvent("input.type") || !tr.docChanged) { return tr; }

		let shouldTryExpansion: boolean = false;

		// Iterate over each change made to the document
		tr.changes.iterChanges(
		(fromA: number, toA: number, fromB: number, toB: number, inserted: any) =>
		{
			// Only try expansion if the shortcut suffix's end character was hit
			if (inserted.text[0] === this.suffixEndCharacter)
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
	// important for CM5, as the typed key isn't in the editor until the calling event finishes.
	private tryShortcutExpansion_internal(): void { setTimeout(async () =>
	{
		const editor: any  = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		if (!editor) { return; }

		// Find bounds of the shortcut beneath the caret (if there is one)
		const cursor: any = editor.getCursor();
		const lineText: string = editor.getLine(cursor.line);
		const prefixIndex: number = lineText.lastIndexOf(this.settings.prefix, cursor.ch);
		const suffixIndex: number = lineText.indexOf(
			this.settings.suffix, prefixIndex + this.settings.prefix.length);

		// If the caret is not at a shortcut, early-out
		if (prefixIndex === -1 || suffixIndex === -1 ||
		    (suffixIndex + this.settings.suffix.length) < cursor.ch)
		{
			return;
		}

		// Get the shortcut text to expand, and the info on this expansion
		const shortcutText: string =
			lineText.slice(prefixIndex + this.settings.prefix.length, suffixIndex);
		const expansionInfo: any =
		{
			isUserTriggered: true,
			line: lineText,
			inputStart: prefixIndex,
			inputEnd: suffixIndex + this.settings.suffix.length,
			shortcutText: shortcutText,
			prefix: this.settings.prefix,
			suffix: this.settings.suffix
		};

		// Disable input during the exansion (in case it takes a while)
		InputBlocker.setEnabled(true);

		// Run the expansion
		let expansionText: string = null;
		try
		{
			expansionText = await ShortcutExpander.expand(shortcutText, false, expansionInfo);
		}
		catch (e) {}

		// Enable input, now that the expansion is over
		InputBlocker.setEnabled(false);

		if (expansionText === null) { return; }

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
