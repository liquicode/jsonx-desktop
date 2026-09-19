'use strict';

/*
	The desktop's side of the host interface (jsonx-cli's types/jsonx-host.d.ts, cut 6 step 2).

	The page asks for what only its host can give, and shows a control only for a capability the host
	lists - so the Web UI is never forked, and a capability added here appears in the page by itself.
	This module is what each capability does; `main/preload.js` is how the page reaches it, and
	`main/main.js` hands both the pieces of Electron they use.

	-	***Electron's pieces are parameters*** (Dialog, Clipboard, Notification, WriteFile, Windows), so
		every capability is tested with stubs and no window.
	-	***A capability the host was not given is not listed***, which is how step 2 provides three of the
		six: what is missing is simply absent from the page.
	-	***Each answer is a promise of true or false***, false meaning the person cancelled or the host
		could not - never an exception the page has to catch.

	Step 3 adds OpenFile and RecentFiles, and step 4 OpenTerminal. NewFile came after cut 6 (2026-09-19).
*/

const LIB_PATH = require( 'path' );


const KIND = 'desktop';
const NEW_FILE = 'New file.jsonx';


//---------------------------------------------------------------------
/*
	Options:
		Dialog          Electron's dialog, for SaveText
		Clipboard       Electron's clipboard, for CopyText
		Notification    Electron's Notification class, for Notify
		WriteFile       async ( Path, Text ); default fs.promises.writeFile
		WindowFor       optional, ( ) => the BrowserWindow a dialog belongs to
		OpenPath        async ( Path ) => { Path, Ui } or null, for OpenFile, NewFile and OpenPath
		Skeleton        async ( Name ) => a new file's text, for NewFile
		FolderFor       optional, ( ) => the folder a new file is suggested in
		OpenTerminal, RecentList, UiFor: see each capability below
*/

function NewHost( Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let host = {};

	host.Kind = KIND;


	//---------------------------------------------------------------------
	// Tells the person something outside the page: only when the system will show it.

	if ( options.Notification )
	{
		host.Notify = async function ( Title, Text )
		{
			let Notification_ = options.Notification;
			if ( typeof Notification_.isSupported === 'function' && !Notification_.isSupported() ) { return false; }
			try
			{
				let notification = new Notification_( { title: String( Title ), body: String( Text || '' ) } );
				notification.show();
				return true;
			}
			catch ( error ) { return false; }
		};
	}


	//---------------------------------------------------------------------
	if ( options.Clipboard )
	{
		host.CopyText = async function ( Text )
		{
			try
			{
				options.Clipboard.writeText( String( Text ) );
				return true;
			}
			catch ( error ) { return false; }
		};
	}


	//---------------------------------------------------------------------
	// Asks where to put the text, and writes it. Cancelled is false, not an error.

	if ( options.Dialog )
	{
		host.SaveText = async function ( SuggestedName, Text )
		{
			let name = String( SuggestedName || 'jsonx.json' );
			let request = {
				defaultPath: name,
				filters: [
					{ name: 'JSON', extensions: [ 'json' ] },
					{ name: 'All files', extensions: [ '*' ] },
				],
			};
			try
			{
				let window_ = ( typeof options.WindowFor === 'function' ) ? options.WindowFor() : null;
				let chosen = window_
					? await options.Dialog.showSaveDialog( window_, request )
					: await options.Dialog.showSaveDialog( request );
				if ( !chosen || chosen.canceled || !chosen.filePath ) { return false; }
				let write = options.WriteFile || require( 'fs' ).promises.writeFile;
				await write( chosen.filePath, String( Text ) );
				return true;
			}
			catch ( error ) { return false; }
		};
	}


	//---------------------------------------------------------------------
	// Asks the person for a .jsonx file and opens it in its own process. Cancelled is null.

	if ( options.Dialog && typeof options.OpenPath === 'function' )
	{
		host.OpenFile = async function ()
		{
			let request = {
				title: 'Open a jsonx file',
				properties: [ 'openFile' ],
				filters: [
					{ name: 'jsonx files', extensions: [ 'jsonx' ] },
					{ name: 'All files', extensions: [ '*' ] },
				],
			};
			let chosen = null;
			try
			{
				let window_ = ( typeof options.WindowFor === 'function' ) ? options.WindowFor() : null;
				chosen = window_
					? await options.Dialog.showOpenDialog( window_, request )
					: await options.Dialog.showOpenDialog( request );
			}
			catch ( error ) { return null; }
			if ( !chosen || chosen.canceled || !chosen.filePaths || chosen.filePaths.length === 0 ) { return null; }

			// Opening says what went wrong itself, in front of the person; the page hears null.
			try { return await options.OpenPath( chosen.filePaths[ 0 ] ); }
			catch ( error ) { return null; }
		};
	}


	//---------------------------------------------------------------------
	/*
		A new file: asks where it goes, writes the skeleton `jsonx new file` prints there under the name the
		person typed, and opens it as any other file is opened. Cancelled is null.

		***The skeleton is jsonx-cli's***, asked for through its command line (decision 10), so a new file from
		the desktop is the one the readme tells a command line user to start from, and validates the same way.
		A file which could not be made says so in front of the person, as opening does.
	*/

	if ( options.Dialog && typeof options.OpenPath === 'function' && typeof options.Skeleton === 'function' )
	{
		host.NewFile = async function ()
		{
			let folder = ( typeof options.FolderFor === 'function' ) ? options.FolderFor() : null;
			let request = {
				title: 'New jsonx file',
				defaultPath: folder ? LIB_PATH.join( folder, NEW_FILE ) : NEW_FILE,
				filters: [
					{ name: 'jsonx files', extensions: [ 'jsonx' ] },
				],
			};
			let window_ = ( typeof options.WindowFor === 'function' ) ? options.WindowFor() : null;
			let chosen = null;
			try
			{
				chosen = window_
					? await options.Dialog.showSaveDialog( window_, request )
					: await options.Dialog.showSaveDialog( request );
			}
			catch ( error ) { return null; }
			if ( !chosen || chosen.canceled || !chosen.filePath ) { return null; }

			let path = chosen.filePath;
			if ( LIB_PATH.extname( path ) === '' ) { path += '.jsonx'; }
			try
			{
				let text = await options.Skeleton( FileName( path ) );
				let write = options.WriteFile || require( 'fs' ).promises.writeFile;
				await write( path, text );
			}
			catch ( error )
			{
				let message = {
					type: 'error',
					title: 'jsonx',
					message: 'Cannot make ' + LIB_PATH.basename( path ) + '.',
					detail: String( error.Stderr || error.message || '' ).trim(),
				};
				try
				{
					if ( window_ ) { await options.Dialog.showMessageBox( window_, message ); }
					else { await options.Dialog.showMessageBox( message ); }
				}
				catch ( ignored ) { /* nothing more to say it with */ }
				return null;
			}

			try { return await options.OpenPath( path ); }
			catch ( error ) { return null; }
		};
	}


	//---------------------------------------------------------------------
	// Opens a file the host already knows of: one from RecentFiles, or one the menu names.

	if ( typeof options.OpenPath === 'function' )
	{
		host.OpenPath = async function ( Path )
		{
			try { return await options.OpenPath( Path ); }
			catch ( error ) { return null; }
		};
	}


	//---------------------------------------------------------------------
	// A jsonx terminal on this file's process (O7): the page jsonx-cli serves at <Ui>terminal.html, in a
	// window of its own. It is not an operating system shell, and nothing here can make it one.

	if ( typeof options.OpenTerminal === 'function' )
	{
		host.OpenTerminal = async function ()
		{
			try { return ( await options.OpenTerminal() ) !== false; }
			catch ( error ) { return false; }
		};
	}


	//---------------------------------------------------------------------
	// The files opened lately, newest first, each with the address of its Web UI when it is open now.

	if ( typeof options.RecentList === 'function' )
	{
		host.RecentFiles = async function ()
		{
			let list = [];
			try { list = await options.RecentList(); }
			catch ( error ) { return []; }
			return ( list || [] ).map( function ( Each )
			{
				let file = { Path: Each.Path };
				let ui = ( typeof options.UiFor === 'function' ) ? options.UiFor( Each.Path ) : null;
				if ( ui ) { file.Ui = ui; }
				return file;
			} );
		};
	}


	//---------------------------------------------------------------------
	// The names the page may show a control for: every capability this host was given.

	host.Capabilities = function ()
	{
		let names = [];
		Object.keys( host ).forEach( function ( Name )
		{
			if ( Name === 'Capabilities' ) { return; }
			if ( typeof host[ Name ] === 'function' ) { names.push( Name ); }
		} );
		return names;
	};

	return host;
}


//---------------------------------------------------------------------
// The jsonx terminal's page on a process's Web UI: <Ui>terminal.html, whatever port it is on.

function TerminalUrl( Ui )
{
	let ui = String( Ui || '' );
	if ( ui === '' ) { return null; }
	if ( ui[ ui.length - 1 ] !== '/' ) { ui += '/'; }
	return ui + 'terminal.html';
}


//---------------------------------------------------------------------
// A name to suggest for a file saved out of a file's page: the file's own name, with a new ending.

function SuggestedName( FilePath, Ending )
{
	let base = LIB_PATH.basename( String( FilePath || 'jsonx' ) );
	let dot = base.lastIndexOf( '.' );
	if ( dot > 0 ) { base = base.slice( 0, dot ); }
	return base + '.' + String( Ending || 'json' );
}


//---------------------------------------------------------------------
// The Name a new file carries: its file name without the ending, as the person typed it.

function FileName( FilePath )
{
	let base = LIB_PATH.basename( String( FilePath || '' ) );
	let dot = base.lastIndexOf( '.' );
	if ( dot > 0 ) { base = base.slice( 0, dot ); }
	return base;
}


//---------------------------------------------------------------------
module.exports = {
	KIND: KIND,
	NewHost: NewHost,
	FileName: FileName,
	TerminalUrl: TerminalUrl,
	SuggestedName: SuggestedName,
};
