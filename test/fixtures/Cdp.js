'use strict';

/*
	The app, driven over the DevTools protocol (cut 6 step 2).

	A copy of jsonx-cli's test/fixtures/Cdp.js, which drives Chrome or Edge for the Web UI's tests - a
	fixture is not a library, so it is lifted rather than reached for. What differs:

	-	***Electron is started, not a browser***, with `--remote-debugging-port=0` and a throwaway
		`--user-data-dir`, and the port read from that folder's DevToolsActivePort as Chromium writes it.
	-	***Its windows are attached to, not opened***: `/json/list` is asked until the window's page is
		there, because the app decides what to open, not the test.
	-	***No browser installed is a failure***; here, no Electron is a failure too. A green run means a
		window was driven.
*/

const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );


const KEYS = {
	Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
	Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
	Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
	ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
	ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
};

const MODIFIERS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };


//---------------------------------------------------------------------
function wait( Ms ) { return new Promise( function ( Resolve ) { setTimeout( Resolve, Ms ); } ); }


// The Electron this package installs.
function FindElectron()
{
	let path = null;
	try { path = require( 'electron' ); }
	catch ( error ) { throw new Error( 'Electron is not installed: ' + error.message ); }
	if ( typeof path !== 'string' || !LIB_FS.existsSync( path ) )
	{
		throw new Error( 'Electron is installed but its binary is not there: run `node node_modules/electron/install.js` in the workspace.' );
	}
	return path;
}


//---------------------------------------------------------------------
// One page target: commands, events, and the input a person makes.

async function open_target( WebSocketUrl )
{
	let socket = new WebSocket( WebSocketUrl );
	await new Promise( function ( Resolve, Reject )
	{
		socket.onopen = Resolve;
		socket.onerror = function () { Reject( new Error( 'The DevTools connection did not open.' ) ); };
	} );

	let next_id = 0;
	let pending = {};
	let listeners = [];
	let page = { Console: [], Errors: [] };

	socket.onmessage = function ( Message )
	{
		let message = JSON.parse( String( Message.data ) );
		if ( typeof message.id === 'number' && pending[ message.id ] )
		{
			let request = pending[ message.id ];
			delete pending[ message.id ];
			if ( message.error ) { request.Reject( new Error( message.error.message ) ); }
			else { request.Resolve( message.result ); }
			return;
		}
		if ( message.method === 'Runtime.consoleAPICalled' )
		{
			let text = ( message.params.args || [] ).map( function ( Arg ) { return ( typeof Arg.value !== 'undefined' ) ? String( Arg.value ) : ( Arg.description || '' ); } ).join( ' ' );
			page.Console.push( { Type: message.params.type, Text: text } );
			if ( message.params.type === 'error' ) { page.Errors.push( text ); }
		}
		if ( message.method === 'Runtime.exceptionThrown' )
		{
			let details = message.params.exceptionDetails || {};
			page.Errors.push( ( details.exception && details.exception.description ) || details.text || 'an exception' );
		}
		if ( message.method === 'Log.entryAdded' && message.params.entry.level === 'error' )
		{
			page.Errors.push( message.params.entry.text + ( message.params.entry.url ? ' (' + message.params.entry.url + ')' : '' ) );
		}
		listeners.slice().forEach( function ( Listener ) { Listener( message ); } );
		return;
	};

	page.OnEvent = function ( Listener ) { listeners.push( Listener ); return; };

	page.Send = function ( Method, Params )
	{
		next_id++;
		let id = next_id;
		return new Promise( function ( Resolve, Reject )
		{
			pending[ id ] = { Resolve: Resolve, Reject: Reject };
			socket.send( JSON.stringify( { id: id, method: Method, params: Params || {} } ) );
		} );
	};

	page.Evaluate = async function ( Expression )
	{
		let result = await page.Send( 'Runtime.evaluate', { expression: Expression, returnByValue: true, awaitPromise: true } );
		if ( result.exceptionDetails )
		{
			let details = result.exceptionDetails;
			throw new Error( 'In the page: ' + ( ( details.exception && details.exception.description ) || details.text ) );
		}
		return result.result ? result.result.value : undefined;
	};

	page.WaitFor = async function ( Expression, TimeoutMs )
	{
		let limit = Date.now() + ( TimeoutMs || 15000 );
		while ( Date.now() < limit )
		{
			let value = null;
			try { value = await page.Evaluate( Expression ); }
			catch ( error ) { value = null; }
			if ( value ) { return value; }
			await wait( 50 );
		}
		throw new Error( 'The page did not come to [' + Expression + '] within ' + ( TimeoutMs || 15000 ) + ' ms. Errors: ' + JSON.stringify( page.Errors ) );
	};

	page.Type = async function ( Text )
	{
		for ( let ch of String( Text ) )
		{
			await page.Send( 'Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch } );
			await page.Send( 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch } );
		}
		return;
	};

	page.Press = async function ( Key, Modifiers )
	{
		let modifiers = ( Modifiers || [] ).reduce( function ( Bits, Name ) { return Bits | ( MODIFIERS[ Name ] || 0 ); }, 0 );
		let named = KEYS[ Key ];
		let base = named
			? Object.assign( {}, named )
			: { key: Key, code: 'Key' + String( Key ).toUpperCase(), windowsVirtualKeyCode: String( Key ).toUpperCase().charCodeAt( 0 ), text: Key };
		if ( modifiers & ( MODIFIERS.Control | MODIFIERS.Alt | MODIFIERS.Meta ) ) { delete base.text; }
		await page.Send( 'Input.dispatchKeyEvent', Object.assign( { type: base.text ? 'keyDown' : 'rawKeyDown', modifiers: modifiers }, base ) );
		await page.Send( 'Input.dispatchKeyEvent', Object.assign( { type: 'keyUp', modifiers: modifiers }, base, { text: undefined } ) );
		return;
	};

	page.Click = async function ( Selector, ClickCount )
	{
		let box = await page.Evaluate( '( function () { let e = document.querySelector( ' + JSON.stringify( Selector ) + ' ); if ( !e ) { return null; } e.scrollIntoView( { block: "center" } ); let r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; } )()' );
		if ( !box ) { throw new Error( 'Nothing on the page matches [' + Selector + '].' ); }
		if ( box.w === 0 || box.h === 0 ) { throw new Error( 'The element [' + Selector + '] is not visible.' ); }
		let count = ClickCount || 1;
		for ( let index = 1; index <= count; index++ )
		{
			await page.Send( 'Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: index } );
			await page.Send( 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: index } );
		}
		return;
	};

	page.Close = function ()
	{
		try { socket.close(); } catch ( error ) { /* already closed */ }
		return;
	};

	await page.Send( 'Page.enable' );
	await page.Send( 'Runtime.enable' );
	await page.Send( 'Log.enable' );
	return page;
}


//---------------------------------------------------------------------
/*
	Starts the app itself, as a person would: `electron <app folder> <arguments>`.
	Resolves with { Electron, Child, Targets(), AttachToPage( Match ), Stop() }.
*/

async function StartApp( Options )
{
	let options = Options || {};
	let electron = FindElectron();
	let profile = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-desktop-cdp-' ) );
	let app_folder = options.App || LIB_PATH.join( __dirname, '..', '..' );

	let argv = [ app_folder ].concat( options.Args || [] );
	argv.unshift( '--user-data-dir=' + profile );
	argv.unshift( '--remote-debugging-port=0' );

	let child = LIB_CHILD_PROCESS.spawn( electron, argv, { stdio: [ 'ignore', 'pipe', 'pipe' ], env: Object.assign( {}, process.env, options.Env || {} ) } );
	let output = '';
	child.stdout.setEncoding( 'utf8' );
	child.stderr.setEncoding( 'utf8' );
	child.stdout.on( 'data', function ( Chunk ) { output += Chunk; } );
	child.stderr.on( 'data', function ( Chunk ) { output += Chunk; } );
	let exited = new Promise( function ( Resolve ) { child.on( 'exit', Resolve ); } );

	let port_file = LIB_PATH.join( profile, 'DevToolsActivePort' );
	for ( let waited = 0; waited < 30000 && !LIB_FS.existsSync( port_file ); waited += 100 ) { await wait( 100 ); }
	if ( !LIB_FS.existsSync( port_file ) )
	{
		child.kill();
		throw new Error( 'The app did not start its DevTools within 30 s. It said: ' + output );
	}
	let port = null;
	for ( let waited = 0; waited < 5000 && !port; waited += 50 )
	{
		port = LIB_FS.readFileSync( port_file, 'utf8' ).split( /\r?\n/ )[ 0 ].trim();
		if ( !port ) { await wait( 50 ); }
	}
	let base = 'http://127.0.0.1:' + port;
	let pages = [];

	let app = {
		Electron: electron,
		Child: child,
		Output: function () { return output; },
	};

	app.Targets = async function ()
	{
		let list = await ( await fetch( base + '/json/list' ) ).json();
		return list.filter( function ( Each ) { return Each.type === 'page'; } );
	};

	// Waits for a window whose address contains Match, and attaches to it.
	app.AttachToPage = async function ( Match, TimeoutMs )
	{
		let limit = Date.now() + ( TimeoutMs || 30000 );
		while ( Date.now() < limit )
		{
			let targets = await app.Targets();
			let found = targets.find( function ( Each ) { return !Match || Each.url.includes( Match ); } );
			if ( found )
			{
				let page = await open_target( found.webSocketDebuggerUrl );
				page.Url = found.url;
				pages.push( page );
				return page;
			}
			await wait( 200 );
		}
		throw new Error( 'No window at [' + ( Match || 'anything' ) + '] within ' + ( TimeoutMs || 30000 ) + ' ms. The app said: ' + output );
	};

	app.Stop = async function ()
	{
		pages.forEach( function ( Page ) { Page.Close(); } );
		child.kill();
		await Promise.race( [ exited, wait( 8000 ) ] );
		for ( let attempt = 0; attempt < 20; attempt++ )
		{
			try { LIB_FS.rmSync( profile, { recursive: true, force: true } ); break; }
			catch ( error ) { await wait( 250 ); }
		}
		return;
	};

	return app;
}


//---------------------------------------------------------------------
module.exports = {
	KEYS: KEYS,
	FindElectron: FindElectron,
	StartApp: StartApp,
};
