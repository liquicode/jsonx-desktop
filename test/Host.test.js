'use strict';

/*
	src/Host.js and main/preload.js against the contract jsonx-cli declares, types/jsonx-host.d.ts -
	read from the installed package, so a change there is seen here. No Electron and no window: Electron's
	pieces are stubs.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_PATH = require( 'path' );
const { describe, it } = require( 'node:test' );

const Host = require( '../src/Host.js' );
const Preload = require( '../main/preload.js' );


const DTS = LIB_FS.readFileSync( LIB_PATH.join( LIB_PATH.dirname( require.resolve( '@liquicode/jsonx-cli/package.json' ) ), 'types', 'jsonx-host.d.ts' ), 'utf8' );


// The members of `interface JsonxHost` in the .d.ts: { Name, Optional, Method }.
function contract()
{
	let body = /export interface JsonxHost\s*\{([\s\S]*?)\n\}/.exec( DTS )[ 1 ];
	let members = [];
	let pattern = /^\t(\w+)(\?)?(\()?/gm;
	let found = pattern.exec( body );
	while ( found !== null )
	{
		members.push( { Name: found[ 1 ], Optional: found[ 2 ] === '?', Method: found[ 3 ] === '(' } );
		found = pattern.exec( body );
	}
	return members;
}

function capability_names()
{
	let union = /export type JsonxHostCapability\s*=([\s\S]*?);/.exec( DTS )[ 1 ];
	return union.match( /'(\w+)'/g ).map( function ( Quoted ) { return Quoted.slice( 1, -1 ); } );
}


// Electron's pieces, as stubs which remember what they were asked.
function stubs( Options )
{
	let options = Options || {};
	let said = { Notified: [], Copied: [], Saved: [], Asked: [] };
	let notification = function ( Settings ) { this.Settings = Settings; this.show = function () { said.Notified.push( [ Settings.title, Settings.body ] ); }; };
	notification.isSupported = function () { return options.NotificationsWork !== false; };
	return {
		Said: said,
		Notification: notification,
		Clipboard: { writeText: function ( Text ) { if ( options.ClipboardRefuses ) { throw new Error( 'no' ); } said.Copied.push( Text ); } },
		Dialog: {
			showSaveDialog: function ( Window, Request )
			{
				let request = Request || Window;
				said.Asked.push( request );
				if ( options.Cancelled ) { return Promise.resolve( { canceled: true, filePath: undefined } ); }
				return Promise.resolve( { canceled: false, filePath: options.ChosenPath || 'C:\\chosen\\rows.json' } );
			},
		},
		WriteFile: function ( Path, Text ) { if ( options.WriteFails ) { return Promise.reject( new Error( 'read only' ) ); } said.Saved.push( [ Path, Text ] ); return Promise.resolve(); },
	};
}

function new_host( Options )
{
	let pieces = stubs( Options );
	let host = Host.NewHost( {
		Notification: pieces.Notification,
		Clipboard: pieces.Clipboard,
		Dialog: pieces.Dialog,
		WriteFile: pieces.WriteFile,
	} );
	host.Said = pieces.Said;
	return host;
}


//---------------------------------------------------------------------
describe( 'The desktop host', function ()
{

	it( 'lists only capabilities the contract declares, and only ones it was given', function ()
	{
		let declared = capability_names();
		let members = contract();
		let host = new_host();

		LIB_ASSERT.strictEqual( host.Kind, 'desktop' );
		LIB_ASSERT.deepStrictEqual( host.Capabilities(), [ 'Notify', 'CopyText', 'SaveText' ] );
		host.Capabilities().forEach( function ( Name )
		{
			LIB_ASSERT.ok( declared.includes( Name ), Name + ' is a declared capability' );
			LIB_ASSERT.strictEqual( typeof host[ Name ], 'function', Name );
			LIB_ASSERT.ok( members.some( function ( Each ) { return Each.Name === Name && Each.Method; } ), Name + ' is a declared member' );
		} );

		// Step 3 and step 4 add these; until then the page shows no control for them.
		[ 'OpenFile', 'RecentFiles', 'OpenTerminal' ].forEach( function ( Name )
		{
			LIB_ASSERT.ok( declared.includes( Name ), Name );
			LIB_ASSERT.strictEqual( host[ Name ], undefined, Name );
		} );

		// A host given nothing lists nothing, which is what makes the page follow the host.
		LIB_ASSERT.deepStrictEqual( Host.NewHost( {} ).Capabilities(), [] );
		LIB_ASSERT.deepStrictEqual( Host.NewHost( { Clipboard: { writeText: function () {} } } ).Capabilities(), [ 'CopyText' ] );
	} );


	it( 'notifies, copies and saves through Electron, and says false when it cannot', async function ()
	{
		let host = new_host();
		LIB_ASSERT.strictEqual( await host.Notify( 'jsonx', 'run finished' ), true );
		LIB_ASSERT.deepStrictEqual( host.Said.Notified, [ [ 'jsonx', 'run finished' ] ] );
		LIB_ASSERT.strictEqual( await host.CopyText( '{"a":1}' ), true );
		LIB_ASSERT.deepStrictEqual( host.Said.Copied, [ '{"a":1}' ] );

		LIB_ASSERT.strictEqual( await host.SaveText( 'rows.json', '[1,2]' ), true );
		LIB_ASSERT.deepStrictEqual( host.Said.Saved, [ [ 'C:\\chosen\\rows.json', '[1,2]' ] ] );
		LIB_ASSERT.strictEqual( host.Said.Asked[ 0 ].defaultPath, 'rows.json' );
		LIB_ASSERT.deepStrictEqual( host.Said.Asked[ 0 ].filters[ 0 ], { name: 'JSON', extensions: [ 'json' ] } );

		// Cancelled, refused and failed are all false, never an exception.
		LIB_ASSERT.strictEqual( await new_host( { Cancelled: true } ).SaveText( 'rows.json', '[]' ), false );
		LIB_ASSERT.strictEqual( await new_host( { WriteFails: true } ).SaveText( 'rows.json', '[]' ), false );
		LIB_ASSERT.strictEqual( await new_host( { ClipboardRefuses: true } ).CopyText( 'x' ), false );
		LIB_ASSERT.strictEqual( await new_host( { NotificationsWork: false } ).Notify( 'jsonx', 'x' ), false );
	} );


	it( 'opens a file the person chooses, and one it is handed', async function ()
	{
		let opened = [];
		function new_opening_host( Options )
		{
			let options = Options || {};
			return Host.NewHost( {
				Dialog: {
					showOpenDialog: function ()
					{
						if ( options.Cancelled ) { return Promise.resolve( { canceled: true, filePaths: [] } ); }
						return Promise.resolve( { canceled: false, filePaths: [ 'C:\\season\\chosen.jsonx' ] } );
					},
				},
				OpenPath: function ( Path )
				{
					if ( options.OpeningFails ) { return Promise.reject( new Error( 'not a jsonx file' ) ); }
					opened.push( Path );
					return Promise.resolve( { Path: Path, Ui: 'http://127.0.0.1:51691/ui/' } );
				},
			} );
		}

		let host = new_opening_host();
		// A host with a dialog can save text too: what it was given is what it lists.
		LIB_ASSERT.deepStrictEqual( host.Capabilities(), [ 'SaveText', 'OpenFile', 'OpenPath' ] );
		LIB_ASSERT.deepStrictEqual( await host.OpenFile(), { Path: 'C:\\season\\chosen.jsonx', Ui: 'http://127.0.0.1:51691/ui/' } );
		LIB_ASSERT.deepStrictEqual( await host.OpenPath( 'C:\\season\\named.jsonx' ), { Path: 'C:\\season\\named.jsonx', Ui: 'http://127.0.0.1:51691/ui/' } );
		LIB_ASSERT.deepStrictEqual( opened, [ 'C:\\season\\chosen.jsonx', 'C:\\season\\named.jsonx' ] );

		// Cancelled is null, and so is a file which would not open - which said so itself, in front of the person.
		LIB_ASSERT.strictEqual( await new_opening_host( { Cancelled: true } ).OpenFile(), null );
		LIB_ASSERT.strictEqual( await new_opening_host( { OpeningFails: true } ).OpenFile(), null );
		LIB_ASSERT.strictEqual( await new_opening_host( { OpeningFails: true } ).OpenPath( 'C:\\x.jsonx' ), null );
	} );


	it( 'makes a new file where the person says, named as they typed it, and opens it', async function ()
	{
		let said = { Asked: [], Written: [], Opened: [], Told: [] };
		function new_making_host( Options )
		{
			let options = Options || {};
			return Host.NewHost( {
				Dialog: {
					showSaveDialog: function ( Window, Request )
					{
						said.Asked.push( Request || Window );
						if ( options.Cancelled ) { return Promise.resolve( { canceled: true, filePath: undefined } ); }
						return Promise.resolve( { canceled: false, filePath: options.ChosenPath || 'C:\\season\\Inventory.jsonx' } );
					},
					showMessageBox: function ( Window, Message ) { said.Told.push( Message || Window ); return Promise.resolve( { response: 0 } ); },
				},
				FolderFor: function () { return options.Folder || null; },
				Skeleton: function ( Name )
				{
					if ( options.SkeletonFails ) { let error = new Error( 'jsonx new stopped with exit 2.' ); error.Stderr = 'no skeleton\n'; return Promise.reject( error ); }
					return Promise.resolve( '{ "Name": ' + JSON.stringify( Name ) + ' }' );
				},
				WriteFile: function ( Path, Text ) { said.Written.push( [ Path, Text ] ); return Promise.resolve(); },
				OpenPath: function ( Path ) { said.Opened.push( Path ); return Promise.resolve( { Path: Path, Ui: 'http://127.0.0.1:51691/ui/' } ); },
			} );
		}

		let host = new_making_host( { Folder: 'C:\\season' } );
		LIB_ASSERT.deepStrictEqual( host.Capabilities(), [ 'SaveText', 'OpenFile', 'NewFile', 'OpenPath' ] );
		LIB_ASSERT.deepStrictEqual( await host.NewFile(), { Path: 'C:\\season\\Inventory.jsonx', Ui: 'http://127.0.0.1:51691/ui/' } );
		// Suggested beside the file being shown, only as a jsonx file; written with the Name the person typed; then opened.
		LIB_ASSERT.strictEqual( said.Asked[ 0 ].defaultPath, LIB_PATH.join( 'C:\\season', 'New file.jsonx' ) );
		LIB_ASSERT.deepStrictEqual( said.Asked[ 0 ].filters, [ { name: 'jsonx files', extensions: [ 'jsonx' ] } ] );
		LIB_ASSERT.deepStrictEqual( said.Written, [ [ 'C:\\season\\Inventory.jsonx', '{ "Name": "Inventory" }' ] ] );
		LIB_ASSERT.deepStrictEqual( said.Opened, [ 'C:\\season\\Inventory.jsonx' ] );

		// A name typed with no ending gets .jsonx; with no folder to suggest, the dialog chooses.
		said.Written = [];
		await new_making_host( { ChosenPath: 'C:\\season\\Moons' } ).NewFile();
		LIB_ASSERT.deepStrictEqual( said.Written, [ [ 'C:\\season\\Moons.jsonx', '{ "Name": "Moons" }' ] ] );
		LIB_ASSERT.strictEqual( said.Asked[ said.Asked.length - 1 ].defaultPath, 'New file.jsonx' );

		// Cancelled is null and writes nothing.
		said.Written = [];
		LIB_ASSERT.strictEqual( await new_making_host( { Cancelled: true } ).NewFile(), null );
		LIB_ASSERT.deepStrictEqual( said.Written, [] );

		// A file which could not be made says why in front of the person, writes nothing, opens nothing, and is null.
		said.Opened = [];
		LIB_ASSERT.strictEqual( await new_making_host( { SkeletonFails: true } ).NewFile(), null );
		LIB_ASSERT.deepStrictEqual( said.Written, [] );
		LIB_ASSERT.deepStrictEqual( said.Opened, [] );
		LIB_ASSERT.strictEqual( said.Told.length, 1 );
		LIB_ASSERT.strictEqual( said.Told[ 0 ].message, 'Cannot make Inventory.jsonx.' );
		LIB_ASSERT.strictEqual( said.Told[ 0 ].detail, 'no skeleton' );

		// Without a way to make its text, there is no NewFile to offer.
		LIB_ASSERT.strictEqual( Host.NewHost( { Dialog: {}, OpenPath: function () {} } ).NewFile, undefined );
		LIB_ASSERT.strictEqual( Host.FileName( 'C:\\season\\Inventory.jsonx' ), 'Inventory' );
	} );


	it( 'lists the recent files, saying which are open now', async function ()
	{
		let open_now = { 'C:\\season\\a.jsonx': 'http://127.0.0.1:51691/ui/' };
		let host = Host.NewHost( {
			RecentList: function () { return [ { Path: 'C:\\season\\a.jsonx', At: 'x' }, { Path: 'C:\\season\\b.jsonx', At: 'y' } ]; },
			UiFor: function ( Path ) { return open_now[ Path ] || null; },
		} );
		LIB_ASSERT.deepStrictEqual( host.Capabilities(), [ 'RecentFiles' ] );
		LIB_ASSERT.deepStrictEqual( await host.RecentFiles(), [
			{ Path: 'C:\\season\\a.jsonx', Ui: 'http://127.0.0.1:51691/ui/' },
			{ Path: 'C:\\season\\b.jsonx' },
		] );

		// A list which cannot be read is an empty one, never an error in the page.
		let broken = Host.NewHost( { RecentList: function () { throw new Error( 'no' ); } } );
		LIB_ASSERT.deepStrictEqual( await broken.RecentFiles(), [] );
	} );


	it( 'opens a jsonx terminal on the same process', async function ()
	{
		let asked = 0;
		let host = Host.NewHost( { OpenTerminal: function () { asked++; return true; } } );
		LIB_ASSERT.deepStrictEqual( host.Capabilities(), [ 'OpenTerminal' ] );
		LIB_ASSERT.strictEqual( await host.OpenTerminal(), true );
		LIB_ASSERT.strictEqual( asked, 1 );

		// A terminal which cannot be opened, or which fails, is false - never an error in the page.
		LIB_ASSERT.strictEqual( await Host.NewHost( { OpenTerminal: function () { return false; } } ).OpenTerminal(), false );
		LIB_ASSERT.strictEqual( await Host.NewHost( { OpenTerminal: function () { throw new Error( 'no window' ); } } ).OpenTerminal(), false );

		// The page it opens is the one jsonx-cli serves beside the Web UI, on whatever port the file's process took.
		LIB_ASSERT.strictEqual( Host.TerminalUrl( 'http://127.0.0.1:51691/ui/' ), 'http://127.0.0.1:51691/ui/terminal.html' );
		LIB_ASSERT.strictEqual( Host.TerminalUrl( 'http://127.0.0.1:51691/ui' ), 'http://127.0.0.1:51691/ui/terminal.html' );
		LIB_ASSERT.strictEqual( Host.TerminalUrl( '' ), null );
	} );


	it( 'suggests a file name from the file being shown', function ()
	{
		LIB_ASSERT.strictEqual( Host.SuggestedName( 'C:\\season\\observatory.jsonx' ), 'observatory.json' );
		LIB_ASSERT.strictEqual( Host.SuggestedName( 'C:\\season\\observatory.jsonx', 'csv' ), 'observatory.csv' );
		LIB_ASSERT.strictEqual( Host.SuggestedName( null ), 'jsonx.json' );
	} );

} );


//---------------------------------------------------------------------
describe( 'The preload host', function ()
{

	it( 'gives the page one function per capability the main process answers', async function ()
	{
		let calls = [];
		let answers = { Notify: true, CopyText: true, SaveText: false };
		function invoke( Name, Args )
		{
			calls.push( { Name: Name, Args: Args } );
			return Promise.resolve( answers[ Name ] );
		}

		let host = Preload.NewDesktopHost( invoke, [ 'Notify', 'CopyText', 'SaveText' ] );
		LIB_ASSERT.strictEqual( host.Kind, 'desktop' );
		LIB_ASSERT.deepStrictEqual( host.Capabilities(), [ 'Notify', 'CopyText', 'SaveText' ] );
		LIB_ASSERT.strictEqual( host.OpenFile, undefined );

		LIB_ASSERT.strictEqual( await host.Notify( 'jsonx', 'done' ), true );
		LIB_ASSERT.strictEqual( await host.SaveText( 'rows.json', '[]' ), false );
		LIB_ASSERT.deepStrictEqual( calls, [
			{ Name: 'Notify', Args: [ 'jsonx', 'done' ] },
			{ Name: 'SaveText', Args: [ 'rows.json', '[]' ] },
		] );

		// The page is never given an exception to catch: a refused call is false, or null where a value was asked for.
		let refusing = Preload.NewDesktopHost( function () { return Promise.reject( new Error( 'refused' ) ); }, [ 'CopyText', 'OpenFile', 'NewFile', 'RecentFiles' ] );
		LIB_ASSERT.strictEqual( await refusing.CopyText( 'x' ), false );
		LIB_ASSERT.strictEqual( await refusing.OpenFile(), null );
		LIB_ASSERT.strictEqual( await refusing.NewFile(), null );
		LIB_ASSERT.strictEqual( await refusing.RecentFiles(), null );

		// What it lists is what it was told, so a step which adds a capability changes nothing here.
		LIB_ASSERT.deepStrictEqual( Preload.NewDesktopHost( invoke, [] ).Capabilities(), [] );
		let every = Preload.NewDesktopHost( invoke, capability_names() );
		capability_names().forEach( function ( Name ) { LIB_ASSERT.strictEqual( typeof every[ Name ], 'function', Name ); } );
	} );

} );
