///////////////////////////////////////////////////////////////////////////////////////////////
// Dynamic File Content (dfc) - Maintain a list of files to (optionally) monitor for updates //
///////////////////////////////////////////////////////////////////////////////////////////////

"use strict";

enum DfcMonitorType { None, OnModify, OnTouch };

class Dfc
{
	public constructor(
		plugin: any, filenames: Array<string>, refreshFnc: Function, onFileRemoved: Function,
		fileOrderImportant: boolean)
	{
		this.constructor_internal(plugin, filenames, refreshFnc, onFileRemoved, fileOrderImportant);
	}

	// Called when this Dfc is no longer needed.
	public destructor(): void
	{
		this.setMonitorType(DfcMonitorType.None);
	}

	// Define what triggers this Dfc to call the refreshFnc
	// - None - refreshFnc is never called
	// - OnModify - refreshFnc is called when a monitored file is changed, and moved away from.
	// - OnTouch - refreshFnc is called when a monitored file is moved away from.
	public setMonitorType(monitorType: DfcMonitorType): void
	{
		this.setMonitorType_internal(monitorType);
	}

	// Pass in a new list of files to monitor.
	// The Dfc's current monitored files list is updated to match.
	// If this ends up changing the Dfc's list, refreshFnc called.
	// Alternately, forceRefresh being true will force refreshFnc to be called.
	public updateFileList(newFileList: Array<string>, forceRefresh?: boolean) : void
	{
		this.updateFileList_internal(newFileList, forceRefresh);
	}

///////////////////////////////////////////////////////////////////////////////////////////////////

	private plugin: any;
	private refreshFnc: Function;
	private fileOrderImportant: boolean;
	private onFileRemoved: Function;
	private fileData: any;
	private monitorType: DfcMonitorType;
	private currentFilesName: string;
	private currentFileWasModified: boolean;
	private _onAnyFileModified: any;
	private _onActiveLeafChange: any;
	private _onAnyFileAddedOrRemoved: any;

	private constructor_internal(
		plugin: any, filenames: Array<string>, refreshFnc: Function, onFileRemoved: Function,
		fileOrderImportant: boolean): void
	{
		this.plugin = plugin;

		// The callback for when monitored files have triggered a refresh
		this.refreshFnc = refreshFnc;

		// A callback for when files are removed from the list
		this.onFileRemoved = onFileRemoved;

		// If true, changes to the order of the files trigger a refresh (just like file changes do)
		this.fileOrderImportant = fileOrderImportant;

		// The list of files this Dfc monitors
		this.fileData = {};

		// This var determines What need to happen to monitored files to trigger calling refreshFnc.
		// Note - DfcMonitorType: None, OnModify or OnTouch).  It has a setter.
		this.monitorType = DfcMonitorType.None;

		// Maintain the current active-file, so that when "active-leaf-change" hits (i.e. the 
		// active-file is set to a different file) you still have access to the prior active-file.
		this.currentFilesName = this.plugin.app.workspace.getActiveFile()?.path ?? "";

		// Flag set when the current file is modified.
		this.currentFileWasModified = false;

		// Setup bound versions of these functions for persistent use
		this._onAnyFileModified = this.onAnyFileModified.bind(this);
		this._onActiveLeafChange = this.onActiveLeafChange.bind(this);
		this._onAnyFileAddedOrRemoved = this.onAnyFileAddedOrRemoved.bind(this);

		// Delay setting up the monitored files list, since it WILL trigger a refreshFnc
		// call, and refreshFnc might expect this Dfc to already be assigned to a variable,
		// which it won't be until AFTER this constructor is finished.
		setTimeout(() =>
		{
			this.updateFileList(filenames, true);
		}, 0);
	}

	private setMonitorType_internal(monitorType: DfcMonitorType): void
	{
		if (monitorType == this.monitorType) { return; }

		// At Obsidian start, some Obsidian events trigger haphazardly.  We use
		// onLayoutReady to wait to connect to the events until AFTER the random triggering
		// has passed.
		this.plugin.app.workspace.onLayoutReady(() =>
		{
			// React to old monitor type
			if (this.monitorType != DfcMonitorType.None)
			{
				this.plugin.app.vault.off("modify", this._onAnyFileModified);
				this.plugin.app.workspace.off("active-leaf-change", this._onActiveLeafChange);
				this.plugin.app.vault.off("create", this._onAnyFileAddedOrRemoved);
				this.plugin.app.vault.off("delete", this._onAnyFileAddedOrRemoved);
			}

			this.monitorType = monitorType;

			// React to new monitor type
			if (this.monitorType != DfcMonitorType.None)
			{
				this.plugin.app.vault.on("modify", this._onAnyFileModified);
				this.plugin.app.workspace.on("active-leaf-change", this._onActiveLeafChange);
				this.plugin.app.vault.on("create", this._onAnyFileAddedOrRemoved);
				this.plugin.app.vault.on("delete", this._onAnyFileAddedOrRemoved);
			}

			// Update Dfc state to monitor the active file
			this.currentFilesName = this.plugin.app.workspace.getActiveFile()?.path ?? "";
		});
	}

	// Monitor when the current file is modified.  If it is, turn on "active leaf changed"
	// event to handle refreshFnc call.
	private onAnyFileModified(file: any): void
	{
		// Ignore unmonitored files
		if (!this.fileData[file.path]) { return; }

		// If current file was modified, remember to call refreshFnc when leaving the file
		// the file
		if (file.path == this.currentFilesName)
		{
			this.currentFileWasModified = true;
		}

		// If non-current file was modified, call refreshFnc immediately
		else
		{
			this.refresh(true);
		}
	}

	// Monitor when a different file becomes the active one. If the prior active file is one
	// of the files being monitored then this can trigger a refreshFnc call.
	private onActiveLeafChange(): void
	{
		// Ignore unmonitored files
		if (this.fileData[this.currentFilesName])
		{
			// If leaving a file and it was changed, or monitorType == OnTouch, refresh
			if (this.currentFileWasModified || this.monitorType == DfcMonitorType.OnTouch)
			{
				this.refresh(true);
			}
		}

		// Update Dfc state to monitor the active file
		this.currentFileWasModified = false;
		this.currentFilesName = this.plugin.app.workspace.getActiveFile()?.path ?? "";
	}

	// Monitor when files are added to or removed from the vault. If the file is one of the
	// ones being monitored, refreshFnc is called.
	private onAnyFileAddedOrRemoved(file: any): void
	{
		// Ignore unmonitored files
		if (!this.fileData[file.path]) { return; }

		if (this.fileData.hasOwnProperty(file.path))
		{
			this.refresh(true);
		}
	}

	public updateFileList_internal(newFileList: Array<string>, forceRefresh?: boolean) : void
	{
		let hasChanged: boolean = false;

		// Synchronize this.fileData with newFileList
		for (const filename in this.fileData)
		{
			if (!newFileList.includes(filename))
			{
				if (this.onFileRemoved)
				{
					this.onFileRemoved(filename);
				}
				delete this.fileData[filename];
				hasChanged = true;
			}
		}
		for (const newFile of newFileList)
		{
			if (!this.fileData.hasOwnProperty(newFile))
			{
				this.fileData[newFile] = { modDate: Number.MIN_SAFE_INTEGER };
				if (this.fileOrderImportant)
				{
					this.fileData[newFile].ordering = -1;
				}
				hasChanged = true;
			}
		}

		// Check changes to file order
		if (this.fileOrderImportant)
		{
			for (let i: number = 0; i < newFileList.length; i++)
			{
				if (this.fileData[newFileList[i]].ordering != i)
				{
					this.fileData[newFileList[i]].ordering = i;
					hasChanged = true;
				}
			}
		}

		this.refresh(hasChanged || forceRefresh);
	}

	// Calls refreshFnc if warranted.  refreshFnc is the callback for when monitored files
	// require a refresh.  This calls refreshFnc either when forceRefresh is true, or if one or
	// more of the monitored files have changed (i.e. their modified date has changed).
	private refresh(forceRefresh?: boolean): void
	{
		this.plugin.app.workspace.onLayoutReady(async () =>
		{
			let hasChanged: boolean = false;

			// If forceRefresh, then we know we're going to call refreshFnc, but we
			// still need check modified dates to keep our records up to date.
			for (const filename in this.fileData)
			{
				const file: any = this.plugin.app.vault.fileMap[filename];

				// If file exists...
				if (file)
				{
					// Check mod-date.  If newer then recorded, record new
					// mod-date and that refreshFnc should be called
					if (this.fileData[filename].modDate < file.stat.mtime)
					{
						this.fileData[filename].modDate = file.stat.mtime;
						hasChanged = true;
					}
				}

				// If file doesn't exist, but a valid mod-date is recorded for it,
				// invalidate mod-date and record that refreshFnc should be called
				else if (this.fileData[filename].modDate != Number.MIN_SAFE_INTEGER)
				{
					this.fileData[filename].modDate = Number.MIN_SAFE_INTEGER;
					hasChanged = true;
				}
			}

			// call refreshFnc if a file has changed, or refresh is being forced
			if ((hasChanged || forceRefresh) && this.refreshFnc)
			{
				this.refreshFnc();
			}
		});
	}
}