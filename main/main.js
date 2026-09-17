'use strict';

/*
	The desktop's wiring (cut 6 step 2). It holds no decision of its own: a process per file comes from
	src/Processes.js, the capabilities from src/Host.js, what a window may load from src/Guards.js. This
	file only hands those modules Electron's pieces and puts a window in front of them.

	***A window is a file's own Web UI***, served by that file's `jsonx` process (decision 10). Closing a
	window stops its process; closing the last window quits.

	***One instance runs*** (step 3): a second one, started by opening a file, hands its command line to the
	first and stops, so a file opened twice is one process and one window.

	Step 4 adds the terminal.
*/

const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_PATH = require( 'path' );
const { app, BrowserWindow, Menu, Notification, clipboard, dialog, ipcMain, shell } = require( 'electron' );

const Processes = require( '../src/Processes.js' );
const Host = require( '../src/Host.js' );
const Guards = require( '../src/Guards.js' );
const Args = require( '../src/Args.js' );
const Recent = require( '../src/Recent.js' );
const MenuTemplate = require( '../src/Menu.js' );
const Preload = require( './preload.js' );


const HOMEPAGE = 'http://jsonx.liquicode.com';
const START_PAGE = LIB_PATH.join( __dirname, 'start.html' );


//---------------------------------------------------------------------
let processes = Processes.NewProcesses( {
	Spawn: LIB_CHILD_PROCESS.spawn,
	// Electron's own binary, run as Node (measured 2026-09-15): the desktop ships no Node of its own.
	ExecPath: process.execPath,
	OnExit: function ( Path, Code, Stderr ) { report_stopped( Path, Code, Stderr ); },
} );

let recent = null;

// The file each window shows, and the address it was opened at: by the window's id.
let windows = new Map();


//---------------------------------------------------------------------
function window_entry( Window )
{
	return Window ? windows.get( Window.id ) : null;
}


//---------------------------------------------------------------------
// The window already showing a file, if there is one.

function window_for_path( Path )
{
	let found = null;
	windows.forEach( function ( Entry, Id )
	{
		if ( Entry.Path === LIB_PATH.resolve( Path ) ) { found = BrowserWindow.fromId( Id ); }
	} );
	return found;
}


//---------------------------------------------------------------------
function host_for( Window )
{
	return Host.NewHost( {
		Notification: Notification,
		Clipboard: clipboard,
		Dialog: dialog,
		WindowFor: function () { return Window; },
		OpenPath: async function ( Path ) { return await OpenPath( Path ); },
		OpenTerminal: function () { return OpenTerminalWindow( Window ); },
		RecentList: function () { return recent ? recent.List() : []; },
		UiFor: function ( Path ) { let ready = processes.Lookup( Path ); return ready ? ready.Ui : null; },
	} );
}


//---------------------------------------------------------------------
// Opens a file, or brings its window forward when it is open already. Says what went wrong, and answers
// what the page's host interface promises: { Path, Ui }, or null.

async function OpenPath( Path )
{
	let path = LIB_PATH.resolve( Path );
	let open_already = window_for_path( path );
	if ( open_already )
	{
		open_already.show();
		open_already.focus();
		let ready = processes.Lookup( path );
		return { Path: path, Ui: ready ? ready.Ui : undefined };
	}

	let window_ = null;
	try { window_ = await OpenWindow( path ); }
	catch ( error )
	{
		dialog.showMessageBox( {
			type: 'error',
			title: 'jsonx',
			message: 'Cannot open ' + LIB_PATH.basename( path ) + '.',
			detail: ( error.Stderr || error.message || '' ).trim(),
		} );
		return null;
	}

	let entry = window_entry( window_ );
	close_start_window();
	return { Path: path, Ui: entry ? entry.Ui : undefined };
}


//---------------------------------------------------------------------
// A window on one file: its process started first, so the window has something to show.

async function OpenWindow( Path )
{
	let ready = await processes.Start( Path );

	let window_ = new BrowserWindow( {
		width: 1280,
		height: 900,
		show: false,
		title: LIB_PATH.basename( ready.File ),
		webPreferences: {
			preload: LIB_PATH.join( __dirname, 'preload.js' ),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	} );
	windows.set( window_.id, { Path: ready.File, Ui: ready.Ui, Ready: ready } );
	if ( recent )
	{
		recent.Add( ready.File );
		app.addRecentDocument( ready.File );
		build_menu();
	}

	// The window stays on its own file's Web UI; anything else is the operating system's business.
	window_.webContents.on( 'will-navigate', function ( Event, Url )
	{
		if ( Guards.AllowNavigation( ready.Ui, Url ) ) { return; }
		Event.preventDefault();
		return;
	} );
	window_.webContents.setWindowOpenHandler( function ( Details )
	{
		if ( !Guards.AllowNavigation( ready.Ui, Details.url ) ) { shell.openExternal( Details.url ); }
		return { action: 'deny' };
	} );

	window_.once( 'ready-to-show', function () { window_.show(); } );
	window_.on( 'closed', function ()
	{
		windows.delete( window_.id );
		// The file's terminal talks to this process, so it goes when the file does.
		windows.forEach( function ( Each, Id )
		{
			if ( !Each.Terminal || Each.Path !== ready.File ) { return; }
			let terminal = BrowserWindow.fromId( Id );
			if ( terminal ) { terminal.close(); }
			return;
		} );
		processes.Stop( ready.File );
		return;
	} );

	await window_.loadURL( ready.Ui );
	return window_;
}


//---------------------------------------------------------------------
// A process which stopped on its own: say so on its window, which has nothing to talk to any more.

function report_stopped( Path, Code, Stderr )
{
	windows.forEach( function ( Entry, Id )
	{
		if ( Entry.Path !== Path ) { return; }
		let window_ = BrowserWindow.fromId( Id );
		if ( !window_ ) { return; }
		dialog.showMessageBox( window_, {
			type: 'warning',
			title: 'jsonx',
			message: 'The jsonx process holding ' + LIB_PATH.basename( Path ) + ' stopped (exit ' + Code + ').',
			detail: ( Stderr || '' ).split( /\r?\n/ ).slice( -8 ).join( '\n' ),
		} );
		return;
	} );
	return;
}


//---------------------------------------------------------------------
/*
	A jsonx terminal beside a file's window (O7): the page jsonx-cli serves at <Ui>terminal.html, on the
	same process, so what is typed there and what the window shows are one session. ***It is not a system
	shell***: every line is read by the process's own command table, and this file adds nothing to it.
*/

function OpenTerminalWindow( ForWindow )
{
	let entry = window_entry( ForWindow );
	if ( !entry || !entry.Ui || entry.Start ) { return false; }
	let url = Host.TerminalUrl( entry.Ui );

	// One terminal per file: asking again brings it forward.
	let already = null;
	windows.forEach( function ( Each, Id ) { if ( Each.Terminal && Each.Path === entry.Path ) { already = BrowserWindow.fromId( Id ); } } );
	if ( already ) { already.show(); already.focus(); return true; }

	let window_ = new BrowserWindow( {
		width: 900,
		height: 600,
		show: false,
		title: 'jsonx terminal - ' + LIB_PATH.basename( entry.Path ),
		webPreferences: {
			preload: LIB_PATH.join( __dirname, 'preload.js' ),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	} );
	windows.set( window_.id, { Path: entry.Path, Ui: entry.Ui, Terminal: true } );

	window_.webContents.on( 'will-navigate', function ( Event, Url )
	{
		if ( Guards.AllowNavigation( entry.Ui, Url ) ) { return; }
		Event.preventDefault();
		return;
	} );
	window_.webContents.setWindowOpenHandler( function ( Details )
	{
		if ( !Guards.AllowNavigation( entry.Ui, Details.url ) ) { shell.openExternal( Details.url ); }
		return { action: 'deny' };
	} );

	// Closing a terminal closes nothing else: the file's process belongs to its own window.
	window_.once( 'ready-to-show', function () { window_.show(); } );
	window_.on( 'closed', function () { windows.delete( window_.id ); return; } );

	window_.loadURL( url );
	return true;
}


//---------------------------------------------------------------------
// The start window: the one page the desktop owns, shown when it is started with no file.

let start_window = null;

function OpenStartWindow()
{
	if ( start_window )
	{
		start_window.show();
		start_window.focus();
		return start_window;
	}
	let window_ = new BrowserWindow( {
		width: 620,
		height: 560,
		show: false,
		title: 'jsonx',
		webPreferences: {
			preload: LIB_PATH.join( __dirname, 'preload.js' ),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	} );
	let url = 'file:///' + START_PAGE.split( LIB_PATH.sep ).join( '/' );
	windows.set( window_.id, { Path: null, Ui: url, Start: true } );

	window_.webContents.on( 'will-navigate', function ( Event, Url )
	{
		if ( Guards.AllowNavigation( url, Url ) ) { return; }
		Event.preventDefault();
		return;
	} );
	window_.webContents.setWindowOpenHandler( function ( Details )
	{
		if ( !Guards.AllowNavigation( url, Details.url ) ) { shell.openExternal( Details.url ); }
		return { action: 'deny' };
	} );

	window_.once( 'ready-to-show', function () { window_.show(); } );
	window_.on( 'closed', function ()
	{
		windows.delete( window_.id );
		start_window = null;
		return;
	} );

	window_.loadFile( START_PAGE );
	start_window = window_;
	return window_;
}


// Once a file is open, the start window has done its job.
function close_start_window()
{
	if ( !start_window ) { return; }
	let window_ = start_window;
	start_window = null;
	window_.close();
	return;
}


//---------------------------------------------------------------------
// The menu: a template from src/Menu.js, with its actions wired to what this file can do.

function build_menu()
{
	let template = MenuTemplate.MenuTemplate( {
		Recent: recent ? recent.List() : [],
		Version: app.getVersion(),
	} );
	let actions = {
		OpenFile: async function () { await host_for( BrowserWindow.getFocusedWindow() ).OpenFile(); },
		OpenPath: async function ( Path ) { await OpenPath( Path ); },
		ClearRecent: function () { if ( recent ) { recent.Clear(); } app.clearRecentDocuments(); build_menu(); },
		Quit: function () { app.quit(); },
		OpenHomepage: function () { shell.openExternal( HOMEPAGE ); },
		About: function ()
		{
			dialog.showMessageBox( {
				type: 'info',
				title: 'jsonx',
				message: 'jsonx ' + app.getVersion(),
				detail: 'The jsonx desktop. Each open file runs in its own jsonx process.',
			} );
		},
	};
	Menu.setApplicationMenu( Menu.buildFromTemplate( MenuTemplate.WithActions( template, actions ) ) );
	return;
}


//---------------------------------------------------------------------
// The host interface, answered only for the window the call came from.

ipcMain.on( Preload.CHANNEL + '-capabilities', function ( Event )
{
	Event.returnValue = host_for( null ).Capabilities();
	return;
} );

ipcMain.handle( Preload.CHANNEL, async function ( Event, Name, Args )
{
	let window_ = BrowserWindow.fromWebContents( Event.sender );
	let entry = window_entry( window_ );
	if ( !entry ) { throw new Error( 'There is no window for this call.' ); }
	if ( !Guards.SenderAllowed( entry.Ui, Event.sender.getURL() ) ) { throw new Error( 'That page may not ask for [' + Name + '].' ); }

	let host = host_for( window_ );
	if ( typeof host[ Name ] !== 'function' ) { throw new Error( 'This host does not do [' + Name + '].' ); }
	return await host[ Name ].apply( host, Array.isArray( Args ) ? Args : [] );
} );


//---------------------------------------------------------------------
// Opens what a command line names, or the start window when it names nothing.

async function open_command_line( Argv )
{
	let files = Args.FilesFromArgv( Argv, { Packaged: app.isPackaged } );
	if ( files.length === 0 )
	{
		if ( windows.size === 0 ) { OpenStartWindow(); }
		return;
	}
	for ( let index = 0; index < files.length; index++ )
	{
		await OpenPath( files[ index ] );
	}
	return;
}


//---------------------------------------------------------------------
/*
	***One instance runs.*** Opening a .jsonx file from the Explorer starts the program again, and Windows
	hands it the path; that second instance gives its command line to the first and stops, so a file opened
	twice is one process, one window, brought forward.
*/

if ( !app.requestSingleInstanceLock() )
{
	app.quit();
}
else
{
	app.on( 'second-instance', function ( Event, Argv )
	{
		open_command_line( Argv );
		return;
	} );

	app.whenReady().then( async function ()
	{
		recent = Recent.NewRecent( { Path: LIB_PATH.join( app.getPath( 'userData' ), 'recent.json' ) } );
		build_menu();
		await open_command_line( process.argv );
		return;
	} );
}


app.on( 'window-all-closed', function ()
{
	app.quit();
	return;
} );


// macOS: the dock's Open With, and clicking the icon with nothing open.
app.on( 'open-file', function ( Event, Path )
{
	Event.preventDefault();
	if ( app.isReady() ) { OpenPath( Path ); }
	return;
} );

app.on( 'activate', function ()
{
	if ( windows.size === 0 ) { OpenStartWindow(); }
	return;
} );


app.on( 'before-quit', function ()
{
	processes.StopAll();
	return;
} );
