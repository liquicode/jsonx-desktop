'use strict';

/*
	src/Guards.js and src/Args.js: what a window may load, whose calls are answered, and which file a
	command line names. Plain functions over strings - no Electron, no window.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_PATH = require( 'path' );
const { describe, it } = require( 'node:test' );

const Guards = require( '../src/Guards.js' );
const Args = require( '../src/Args.js' );


const UI = 'http://127.0.0.1:51691/ui/';


//---------------------------------------------------------------------
describe( 'Guards', function ()
{

	it( 'lets a window move about inside its own file s Web UI', function ()
	{
		LIB_ASSERT.strictEqual( Guards.AllowNavigation( UI, UI ), true );
		LIB_ASSERT.strictEqual( Guards.AllowNavigation( UI, UI + 'index.html' ), true );
		LIB_ASSERT.strictEqual( Guards.AllowNavigation( UI, UI + 'terminal.html?file=1#top' ), true );
		LIB_ASSERT.strictEqual( Guards.AllowNavigation( UI, 'http://127.0.0.1:51691/ui/vendor/monaco/loader.js' ), true );
	} );


	it( 'refuses another origin, another file s process, and a page which is not served', function ()
	{
		// Another port is another file's process.
		LIB_ASSERT.strictEqual( Guards.AllowNavigation( UI, 'http://127.0.0.1:51692/ui/' ), false );
		// The same process, outside its Web UI.
		LIB_ASSERT.strictEqual( Guards.AllowNavigation( UI, 'http://127.0.0.1:51691/run' ), false );
		// Somewhere else entirely.
		LIB_ASSERT.strictEqual( Guards.AllowNavigation( UI, 'https://example.com/ui/' ), false );
		LIB_ASSERT.strictEqual( Guards.AllowNavigation( UI, 'http://localhost:51691/ui/' ), false );
		// Not a page a window may be at.
		LIB_ASSERT.strictEqual( Guards.AllowNavigation( UI, 'file:///C:/season/observatory.jsonx' ), false );
		LIB_ASSERT.strictEqual( Guards.AllowNavigation( UI, 'javascript:alert(1)' ), false );
		LIB_ASSERT.strictEqual( Guards.AllowNavigation( UI, 'data:text/html,<b>x</b>' ), false );
		LIB_ASSERT.strictEqual( Guards.AllowNavigation( UI, '' ), false );
		LIB_ASSERT.strictEqual( Guards.AllowNavigation( UI, null ), false );
		LIB_ASSERT.strictEqual( Guards.AllowNavigation( null, UI ), false );
	} );


	it( 'answers a host call only for the page the window was opened at', function ()
	{
		LIB_ASSERT.strictEqual( Guards.SenderAllowed( UI, UI + 'index.html' ), true );
		LIB_ASSERT.strictEqual( Guards.SenderAllowed( UI, 'http://127.0.0.1:51692/ui/index.html' ), false );
		LIB_ASSERT.strictEqual( Guards.SenderAllowed( UI, 'about:blank' ), false );
	} );

} );


//---------------------------------------------------------------------
describe( 'Args', function ()
{

	it( 'takes the jsonx files off a command line, packaged or not', function ()
	{
		let cwd = 'C:\\season';
		let unpackaged = [ 'C:\\electron.exe', 'W:\\jsonx-desktop.git', 'observatory.jsonx' ];
		LIB_ASSERT.deepStrictEqual( Args.FilesFromArgv( unpackaged, { Cwd: cwd } ), [ LIB_PATH.resolve( cwd, 'observatory.jsonx' ) ] );

		let packaged = [ 'C:\\Program Files\\jsonx\\jsonx.exe', 'C:\\season\\observatory.jsonx' ];
		LIB_ASSERT.deepStrictEqual( Args.FilesFromArgv( packaged, { Packaged: true, Cwd: cwd } ), [ 'C:\\season\\observatory.jsonx' ] );

		// Switches are not files, and a file which is not a .jsonx is not opened.
		let noisy = [ 'jsonx.exe', '--squirrel-firstrun', 'notes.txt', 'C:\\season\\second.jsonx', '--inspect' ];
		LIB_ASSERT.deepStrictEqual( Args.FilesFromArgv( noisy, { Packaged: true, Cwd: cwd } ), [ 'C:\\season\\second.jsonx' ] );

		// Several files keep their order; the first is the one to open.
		let two = [ 'jsonx.exe', 'C:\\season\\a.jsonx', 'C:\\season\\b.JSONX' ];
		LIB_ASSERT.deepStrictEqual( Args.FilesFromArgv( two, { Packaged: true, Cwd: cwd } ), [ 'C:\\season\\a.jsonx', 'C:\\season\\b.JSONX' ] );
		LIB_ASSERT.strictEqual( Args.FileFromArgv( two, { Packaged: true, Cwd: cwd } ), 'C:\\season\\a.jsonx' );

		// Nothing named is nothing opened.
		LIB_ASSERT.strictEqual( Args.FileFromArgv( [ 'jsonx.exe' ], { Packaged: true } ), null );
		LIB_ASSERT.strictEqual( Args.FileFromArgv( [], {} ), null );
	} );

} );
