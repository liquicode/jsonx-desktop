'use strict';

/*
	The app itself, once (cut 6 step 2): Electron started on a file as a person would start it, and its
	window driven over the DevTools protocol.

	What this proves that no other test can: the window really loads the file's own Web UI out of the
	child process, Electron's Chromium gets past the loopback guard, and the page finds the host the
	preload gave it. Everything else it might assert belongs to the modules, which are tested without a
	window.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Cdp = require( './fixtures/Cdp.js' );


let folder = null;
let file = null;
let app = null;
let page = null;


//---------------------------------------------------------------------
describe( 'The app', function ()
{

	before( async function ()
	{
		folder = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-desktop-app-' ) );
		file = LIB_PATH.join( folder, 'observatory.jsonx' );
		LIB_FS.writeFileSync( file, JSON.stringify( {
			Name: 'Observatory',
			DataSources: [ { Name: 'Bookings', AdapterName: 'jsonstor-jsonfile', Settings: { Path: 'bookings.json' } } ],
		}, null, '\t' ) );

		app = await Cdp.StartApp( { Args: [ file ] } );
		page = await app.AttachToPage( '/ui/' );
	} );


	after( async function ()
	{
		if ( app ) { await app.Stop(); }
		try { LIB_FS.rmSync( folder, { recursive: true, force: true } ); }
		catch ( error ) { /* the child may still hold it a moment */ }
	} );


	it( 'shows the file s own Web UI, served by the file s own process', async function ()
	{
		// The window is at a loopback address on a port the child chose, not at a file:// page.
		LIB_ASSERT.match( page.Url, /^http:\/\/127\.0\.0\.1:\d+\/ui\// );

		// The page connected to its process and heard what the file holds.
		await page.WaitFor( 'document.body.innerText.includes( "Bookings" )' );

		/*
			***The window's own title is not asserted here***: it belongs to the operating system's window,
			which the DevTools protocol cannot see - a page target carries the document's title, which is
			"jsonx" for every served page. That is exactly why the window is titled by its file in
			main.js, and it is checked on the installed app instead (2026-09-16).
		*/
		LIB_ASSERT.strictEqual( await page.Evaluate( 'document.title' ), 'jsonx' );
	} );


	it( 'gets past the loopback guard, so nothing the page asked for was refused', async function ()
	{
		// Cut 5's lesson: a request the guard refuses shows up here and nowhere else.
		LIB_ASSERT.deepStrictEqual( page.Errors, [] );
		let asked = await page.Evaluate( '( async function () { let answer = await fetch( "/ui/config.json" ); return answer.status; } )()' );
		LIB_ASSERT.strictEqual( asked, 200 );
	} );


	it( 'hands the page a desktop host, and the page follows what it lists', async function ()
	{
		let host = await page.Evaluate( '( function () { let h = window.JsonxHost; return { Kind: h.Kind, Capabilities: h.Capabilities() } } )()' );
		LIB_ASSERT.strictEqual( host.Kind, 'desktop' );
		LIB_ASSERT.deepStrictEqual( host.Capabilities, [ 'Notify', 'CopyText', 'SaveText', 'OpenFile', 'NewFile', 'OpenPath', 'OpenTerminal', 'RecentFiles' ] );

		// A capability the host has reaches the main process and is answered.
		let copied = await page.Evaluate( 'window.JsonxHost.CopyText( "from the desktop" )' );
		LIB_ASSERT.strictEqual( copied, true );

		// The page shows a control for what the host lists.
		LIB_ASSERT.strictEqual( await page.Evaluate( 'document.querySelector( "#jsonx-new-file" ) !== null' ), true );
		LIB_ASSERT.strictEqual( await page.Evaluate( 'document.querySelector( "#jsonx-open-file" ) !== null' ), true );
		LIB_ASSERT.strictEqual( await page.Evaluate( 'document.querySelector( "#jsonx-open-terminal" ) !== null' ), true );

		// The file it opened is in the recent list, and the list says it is open now.
		let recent = await page.Evaluate( 'window.JsonxHost.RecentFiles()' );
		LIB_ASSERT.strictEqual( recent.length, 1 );
		LIB_ASSERT.strictEqual( recent[ 0 ].Path, file );
		LIB_ASSERT.match( recent[ 0 ].Ui, /^http:\/\/127\.0\.0\.1:\d+\/ui\// );
	} );


	it( 'opens a jsonx terminal on the same process as the file s window', async function ()
	{
		// The Terminal button is the page's; what it opens is a window on this file's own process.
		await page.Click( '#jsonx-open-terminal' );
		let terminal = await app.AttachToPage( 'terminal.html' );
		await terminal.WaitFor( 'document.getElementById( "jsonx-prompt-input" ) !== null', 20000 );

		// The same process: its address is the file window's, and it says which file it holds.
		LIB_ASSERT.strictEqual( terminal.Url.replace( 'terminal.html', '' ), page.Url );
		await terminal.WaitFor( 'document.body.innerText.includes( "observatory.jsonx" )', 20000 );
		LIB_ASSERT.deepStrictEqual( terminal.Errors, [] );

		// Asking again brings the same terminal forward rather than opening a second.
		await page.Click( '#jsonx-open-terminal' );
		await new Promise( function ( Resolve ) { setTimeout( Resolve, 1000 ); } );
		let terminals = ( await app.Targets() ).filter( function ( Each ) { return Each.url.includes( 'terminal.html' ); } );
		LIB_ASSERT.strictEqual( terminals.length, 1 );
	} );


	it( 'shows the start window when it is started with no file, and opens a file from it', async function ()
	{
		// Its own instance, with its own settings, so the recent list is this test's.
		let second = await Cdp.StartApp( { Args: [] } );
		try
		{
			let start = await second.AttachToPage( 'start.html' );
			await start.WaitFor( 'document.getElementById( "open" ) !== null' );
			LIB_ASSERT.strictEqual( await start.Evaluate( 'document.getElementById( "new" ) !== null' ), true );

			// With nothing opened yet, it says so.
			LIB_ASSERT.strictEqual( await start.Evaluate( 'document.getElementById( "none" ).hidden' ), false );
			LIB_ASSERT.deepStrictEqual( start.Errors, [] );

			/*
				***The answer to this call is never waited for***: opening a file closes the start window,
				and an evaluation in a page which goes never answers - which hung the whole suite until it
				was found (2026-09-16). What it did is visible in the window it opened.
			*/
			await start.Evaluate( 'window.JsonxHost.OpenPath( ' + JSON.stringify( file ) + ' ); true' );

			let file_page = await second.AttachToPage( '/ui/' );
			await file_page.WaitFor( 'document.body.innerText.includes( "Bookings" )' );
			LIB_ASSERT.deepStrictEqual( file_page.Errors, [] );
		}
		finally { await second.Stop(); }
	} );


	/*
		***A blocked navigation is not tried here*** (2026-09-16): making the window really ask for
		another origin gets it refused, Chromium reports ERR_ABORTED, and Electron shows a modal error
		dialog - which blocks the window, the test and whoever is watching until it is clicked away. The
		rule itself is `Guards.AllowNavigation`, tested in Guards.test.js as the plain function it is, and
		`main/main.js` does nothing with it but ask. Nothing in a window is needed to know it holds.
	*/

} );
