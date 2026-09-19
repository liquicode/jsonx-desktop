'use strict';

/*
	How the page reaches its host (cut 6 step 2): `window.JsonxHost`, the contract jsonx-cli declares in
	types/jsonx-host.d.ts and its page reads through modes/web/public/js/host.js.

	-	***The page keeps its own world***: contextIsolation is on, so nothing here is reachable except the
		object handed over, and every capability is one `ipcRenderer.invoke` - no node, no file system and
		no Electron in the page.
	-	***What the host lists is what the main process answers***: the list is asked for once, when the
		page loads, so a capability added in a later step appears without this file changing shape.
	-	***`NewDesktopHost` is exported for the test***, as jsonx-cli's own host.js is, so the contract is
		checked with no Electron and no window.
*/


const CHANNEL = 'jsonx-host';


//---------------------------------------------------------------------
// Invoke( Name, Arguments ) reaches the main process; Names are the capabilities it answers.

function NewDesktopHost( Invoke, Names )
{
	let names = Array.isArray( Names ) ? Names.slice() : [];
	let host = {};

	host.Kind = 'desktop';

	host.Capabilities = function ()
	{
		return names.slice();
	};

	function calls( Name )
	{
		return function ()
		{
			let args = Array.prototype.slice.call( arguments );
			return Promise.resolve( Invoke( Name, args ) ).then(
				function ( Answer ) { return Answer; },
				function ( Error_ ) { return ( Name === 'OpenFile' || Name === 'NewFile' || Name === 'RecentFiles' ) ? null : false; } );
		};
	}

	names.forEach( function ( Name ) { host[ Name ] = calls( Name ); } );
	return host;
}


//---------------------------------------------------------------------
// In a window: ask the main process what it answers, then hand the page its host.

function Expose()
{
	const { contextBridge, ipcRenderer } = require( 'electron' );

	function invoke( Name, Args )
	{
		return ipcRenderer.invoke( CHANNEL, Name, Args );
	}

	// The capability names, asked for before the page runs.
	let names = ipcRenderer.sendSync( CHANNEL + '-capabilities' );
	contextBridge.exposeInMainWorld( 'JsonxHost', NewDesktopHost( invoke, names ) );
	return;
}


//---------------------------------------------------------------------
let in_a_window = false;
try { in_a_window = ( typeof process === 'object' && process.type === 'renderer' ); }
catch ( error ) { in_a_window = false; }
if ( in_a_window ) { Expose(); }


//---------------------------------------------------------------------
module.exports = {
	CHANNEL: CHANNEL,
	NewDesktopHost: NewDesktopHost,
};
