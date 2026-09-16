'use strict';

/*
	The desktop's wiring (cut 6 step 2). It holds no decision of its own: a process per file comes from
	src/Processes.js, the capabilities from src/Host.js, what a window may load from src/Guards.js. This
	file only hands those modules Electron's pieces and puts a window in front of them.

	***A window is a file's own Web UI***, served by that file's `jsonx` process (decision 10). Closing a
	window stops its process; closing the last window quits.

	Step 3 adds opening files, recent files, the menu and the start window; step 4 the terminal.
*/

const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_PATH = require( 'path' );
const { app, BrowserWindow, Notification, clipboard, dialog, ipcMain, shell } = require( 'electron' );

const Processes = require( '../src/Processes.js' );
const Host = require( '../src/Host.js' );
const Guards = require( '../src/Guards.js' );
const Args = require( '../src/Args.js' );
const Preload = require( './preload.js' );


//---------------------------------------------------------------------
let processes = Processes.NewProcesses( {
	Spawn: LIB_CHILD_PROCESS.spawn,
	// Electron's own binary, run as Node (measured 2026-09-15): the desktop ships no Node of its own.
	ExecPath: process.execPath,
	OnExit: function ( Path, Code, Stderr ) { report_stopped( Path, Code, Stderr ); },
} );

// The file each window shows, and the address it was opened at: by the window's id.
let windows = new Map();


//---------------------------------------------------------------------
function window_entry( Window )
{
	return Window ? windows.get( Window.id ) : null;
}


//---------------------------------------------------------------------
function host_for( Window )
{
	return Host.NewHost( {
		Notification: Notification,
		Clipboard: clipboard,
		Dialog: dialog,
		WindowFor: function () { return Window; },
	} );
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
app.whenReady().then( async function ()
{
	let file = Args.FileFromArgv( process.argv, { Packaged: app.isPackaged } );
	if ( !file )
	{
		// The start window is step 3; until then, say what is missing rather than showing nothing.
		dialog.showErrorBox( 'jsonx', 'Name a .jsonx file to open.' );
		app.quit();
		return;
	}
	try { await OpenWindow( file ); }
	catch ( error )
	{
		dialog.showErrorBox( 'jsonx', error.message + '\n\n' + ( error.Stderr || '' ) );
		app.quit();
	}
	return;
} );


app.on( 'window-all-closed', function ()
{
	app.quit();
	return;
} );


app.on( 'before-quit', function ()
{
	processes.StopAll();
	return;
} );
