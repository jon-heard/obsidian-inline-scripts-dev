////////////////////////////////////////////////////////////////////////////////////////////////
// UserNotifier - wrapper around sending messages to user via console and popup notifications //
////////////////////////////////////////////////////////////////////////////////////////////////

"use strict";

import { Notice } from "obsidian";
import InlineScriptsPlugin from "./_Plugin";

// parameters for "run" (all optional):
// - popupMessage: string
//     - Text displayed in popup notification.  Falls back to "message", then to no popup displayed.
// - ConsoleMessage: string
//     - Text displayed in console.  Falls back to "message", then no console output.
// - message: string
//     - Text displayed in popup (popupMessage overrides) and console (consoleMessage overrides).
// - messageType: string
//     - Text representing message category.  Example: "EXPANSION-ERROR".  Shown in console output.
// - messageLevel
//     - Determines function used for console output.
//     - If "info", use console.info().  If "warn", use console.warn().  Else, use console.error().
// - consoleHasDetails: boolean
//     - If true, popup notification includes a suggestion to review console output for details.
// - popupTime: float
//     - a multiplier for the amount of time that a popup stays on the screen.  Defaults to 1.0.

const LONG_NOTE_TIME: number = 8 * 1000;
const INDENT: string = " ".repeat(4);

export namespace UserNotifier
{
	// Creates a message to the user in a popup notification and/or a console log.
	// Takes an object of optional parameters.  See this file's header for a parameter reference.
	export function run(parameters: any): void
	{
		run_internal(parameters);
	}

	// Offer "print" function for use by user-written shortcuts.
	// Function gives a message to the user in a popup notification and a console log.
	export function getFunction_print(): Function
	{
		return print;
	}

///////////////////////////////////////////////////////////////////////////////////////////////////

	function print(message: any): any
	{
		// Send the message to user as a popup notification and a console log.
		new Notice("Inline Script Shortcut:\n" + message, LONG_NOTE_TIME);
		console.info("Inline Script Shortcut:\n\t" + message);
		return message;
	};

	function run_internal(parameters: any): void
	{
		// Make sure parameters is an object, so the logic for reading it isn't broken.
		if (typeof parameters !== "object")
		{
			parameters = {};
		}

		// Message parameters
		const popupMessage: string = parameters.popupMessage || parameters.message || "";
		const consoleMessage: string =
			(parameters.consoleMessage || parameters.message || "").replaceAll("\n", "\n" + INDENT);

		// Message type and level parameters
		const messageType: string = parameters.messageType || "";
		const messageLevel: number =
			(parameters.messageLevel === "info") ? 0 :
			(parameters.messageLevel === "warn") ? 1 :
			2;

		// Console detail parameter
		const consoleHasDetails = !!parameters.consoleHasDetails;

		// Popup time
		const popupTime = LONG_NOTE_TIME * (parameters.popupTime ?? 1.0);

		// Add the popup notification
		if (popupMessage)
		{
			new Notice(
				(messageLevel === 2 ? "ERROR: " : "") +
				popupMessage +
				(consoleHasDetails ? "\n\n(see console for details)" : ""),
				popupTime);
		}

		// Add the console log
		if (consoleMessage)
		{
			const message =
				InlineScriptsPlugin.getInstance().manifest.name + "\n" +
				(messageType ? (INDENT + messageType + "\n") : "") +
				INDENT + consoleMessage;
			switch (messageLevel)
			{
				case  0: console.info (message); break;
				case  1: console.warn (message); break;
				default: console.error(message); break;
			}
		}
	}
}
