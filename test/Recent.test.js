'use strict';

/*
	src/Recent.js and src/Menu.js: the files opened lately, and the menu which shows them. Both are data -
	no disk and no Electron here.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_PATH = require( 'path' );
const { describe, it } = require( 'node:test' );

const Recent = require( '../src/Recent.js' );
const MenuTemplate = require( '../src/Menu.js' );


// A disk which is only a string, and files which exist unless said otherwise.
function new_recent( Options )
{
	let options = Options || {};
	let disk = { Text: options.Text };
	let gone = options.Gone || [];
	let moment = 1000;
	let recent = Recent.NewRecent( {
		Path: 'C:\\users\\someone\\jsonx\\recent.json',
		ReadFile: function () { if ( typeof disk.Text !== 'string' ) { throw new Error( 'ENOENT' ); } return disk.Text; },
		WriteFile: function ( Path, Text ) { if ( options.ReadOnly ) { throw new Error( 'EACCES' ); } disk.Text = Text; },
		Exists: function ( Path ) { return !gone.includes( Path ); },
		Now: function () { moment += 1000; return moment; },
		Limit: options.Limit,
	} );
	recent.Disk = disk;
	return recent;
}

function paths_of( List )
{
	return List.map( function ( Each ) { return Each.Path; } );
}


//---------------------------------------------------------------------
describe( 'Recent', function ()
{

	it( 'keeps the newest first, once each, up to the limit', function ()
	{
		let recent = new_recent( { Limit: 3 } );
		LIB_ASSERT.deepStrictEqual( recent.List(), [] );

		recent.Add( 'C:\\season\\a.jsonx' );
		recent.Add( 'C:\\season\\b.jsonx' );
		LIB_ASSERT.deepStrictEqual( paths_of( recent.List() ), [ 'C:\\season\\b.jsonx', 'C:\\season\\a.jsonx' ] );

		// A file opened again moves to the top rather than appearing twice.
		recent.Add( 'C:\\season\\a.jsonx' );
		LIB_ASSERT.deepStrictEqual( paths_of( recent.List() ), [ 'C:\\season\\a.jsonx', 'C:\\season\\b.jsonx' ] );

		recent.Add( 'C:\\season\\c.jsonx' );
		recent.Add( 'C:\\season\\d.jsonx' );
		LIB_ASSERT.deepStrictEqual( paths_of( recent.List() ), [ 'C:\\season\\d.jsonx', 'C:\\season\\c.jsonx', 'C:\\season\\a.jsonx' ] );

		// Each entry says when it was opened.
		LIB_ASSERT.match( recent.List()[ 0 ].At, /^\d{4}-\d{2}-\d{2}T/ );
	} );


	it( 'forgets a file which is no longer there, as the list is read', function ()
	{
		let recent = new_recent( { Gone: [ 'C:\\season\\b.jsonx' ] } );
		recent.Add( 'C:\\season\\a.jsonx' );
		recent.Add( 'C:\\season\\b.jsonx' );
		LIB_ASSERT.deepStrictEqual( paths_of( recent.List() ), [ 'C:\\season\\a.jsonx' ] );
		// It is forgotten for good, not only left out of the answer.
		LIB_ASSERT.deepStrictEqual( paths_of( JSON.parse( recent.Disk.Text ) ), [ 'C:\\season\\a.jsonx' ] );
	} );


	it( 'answers an empty list when there is nothing to read, or nonsense to read', function ()
	{
		LIB_ASSERT.deepStrictEqual( new_recent().List(), [] );
		LIB_ASSERT.deepStrictEqual( new_recent( { Text: 'not json' } ).List(), [] );
		LIB_ASSERT.deepStrictEqual( new_recent( { Text: '{"not":"a list"}' } ).List(), [] );
		LIB_ASSERT.deepStrictEqual( new_recent( { Text: '[ { "At": "no path" }, 7 ]' } ).List(), [] );
	} );


	it( 'still works for this run when the list cannot be written', function ()
	{
		let recent = new_recent( { ReadOnly: true } );
		LIB_ASSERT.deepStrictEqual( paths_of( recent.Add( 'C:\\season\\a.jsonx' ) ), [ 'C:\\season\\a.jsonx' ] );
		LIB_ASSERT.deepStrictEqual( recent.List(), [] );
	} );


	it( 'forgets one, and forgets them all', function ()
	{
		let recent = new_recent();
		recent.Add( 'C:\\season\\a.jsonx' );
		recent.Add( 'C:\\season\\b.jsonx' );
		recent.Forget( 'C:\\season\\a.jsonx' );
		LIB_ASSERT.deepStrictEqual( paths_of( recent.List() ), [ 'C:\\season\\b.jsonx' ] );
		recent.Clear();
		LIB_ASSERT.deepStrictEqual( recent.List(), [] );
	} );


	it( 'knows a file by its resolved path, however it was named', function ()
	{
		let recent = new_recent();
		recent.Add( LIB_PATH.join( 'C:\\season', 'a.jsonx' ) );
		recent.Add( LIB_PATH.join( 'C:\\season', '.', 'a.jsonx' ) );
		LIB_ASSERT.strictEqual( recent.List().length, 1 );
	} );

} );


//---------------------------------------------------------------------
describe( 'The menu', function ()
{

	it( 'names only actions which exist', function ()
	{
		let template = MenuTemplate.MenuTemplate( { Recent: [ { Path: 'C:\\season\\a.jsonx' } ], Version: '0.1.0' } );
		let named = MenuTemplate.ActionsNamed( template );
		LIB_ASSERT.deepStrictEqual( named, [ 'OpenFile', 'OpenPath', 'ClearRecent', 'Quit', 'OpenHomepage', 'About' ] );

		// What main.js wires must cover every one of them.
		let actions = { OpenFile: function () {}, OpenPath: function () {}, ClearRecent: function () {}, Quit: function () {}, OpenHomepage: function () {}, About: function () {} };
		named.forEach( function ( Name ) { LIB_ASSERT.strictEqual( typeof actions[ Name ], 'function', Name ); } );
	} );


	it( 'shows the recent files, and says so when there are none', function ()
	{
		let empty = MenuTemplate.MenuTemplate( { Recent: [] } );
		let file_menu = empty[ 0 ].submenu;
		let open_recent = file_menu.find( function ( Each ) { return Each.label === 'Open Recent'; } );
		LIB_ASSERT.deepStrictEqual( open_recent.submenu, [ { label: 'Nothing yet', enabled: false } ] );
		LIB_ASSERT.deepStrictEqual( MenuTemplate.ActionsNamed( empty ).includes( 'OpenPath' ), false );

		let two = MenuTemplate.MenuTemplate( { Recent: [ { Path: 'C:\\season\\a.jsonx' }, { Path: 'C:\\season\\b.jsonx' } ] } );
		let items = two[ 0 ].submenu.find( function ( Each ) { return Each.label === 'Open Recent'; } ).submenu;
		LIB_ASSERT.strictEqual( items[ 0 ].Argument, 'C:\\season\\a.jsonx' );
		LIB_ASSERT.strictEqual( items[ 1 ].Argument, 'C:\\season\\b.jsonx' );
		LIB_ASSERT.strictEqual( items[ items.length - 1 ].Action, 'ClearRecent' );
	} );


	it( 'turns each action into a click, and disables one nothing answers', function ()
	{
		let opened = [];
		let template = MenuTemplate.MenuTemplate( { Recent: [ { Path: 'C:\\season\\a.jsonx' } ] } );
		let wired = MenuTemplate.WithActions( template, { OpenPath: function ( Path ) { opened.push( Path ); } } );

		let recent_items = wired[ 0 ].submenu.find( function ( Each ) { return Each.label === 'Open Recent'; } ).submenu;
		recent_items[ 0 ].click();
		LIB_ASSERT.deepStrictEqual( opened, [ 'C:\\season\\a.jsonx' ] );

		// Nothing is left for Electron to puzzle over, and an action with nobody to call is not offered.
		LIB_ASSERT.strictEqual( recent_items[ 0 ].Action, undefined );
		LIB_ASSERT.strictEqual( recent_items[ 0 ].Argument, undefined );
		let open = wired[ 0 ].submenu.find( function ( Each ) { return Each.label === 'Open...'; } );
		LIB_ASSERT.strictEqual( open.enabled, false );
		LIB_ASSERT.strictEqual( typeof open.click, 'undefined' );

		// Electron's own items are left as they are.
		let view = wired[ 1 ].submenu;
		LIB_ASSERT.ok( view.some( function ( Each ) { return Each.role === 'reload'; } ) );
	} );


	it( 'says Quit on a Mac and Exit everywhere else', function ()
	{
		let mac = MenuTemplate.MenuTemplate( { Platform: 'darwin' } )[ 0 ].submenu;
		let windows_ = MenuTemplate.MenuTemplate( { Platform: 'win32' } )[ 0 ].submenu;
		LIB_ASSERT.ok( mac.some( function ( Each ) { return Each.label === 'Quit'; } ) );
		LIB_ASSERT.ok( windows_.some( function ( Each ) { return Each.label === 'Exit'; } ) );
	} );

} );
