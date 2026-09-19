'use strict';

/*
	src/Processes.js: a jsonx process per open file.

	These run a real `jsonx` child under the Node running the test - no Electron, no window - because
	what is being tested is the command line and the ready line, which are the same either way.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_TEST = require( 'node:test' );
const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );

const Processes = require( '../src/Processes.js' );


//---------------------------------------------------------------------
function new_folder()
{
	return LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-desktop-' ) );
}


function write_file( Folder, Name, Text )
{
	let path = LIB_PATH.join( Folder, Name );
	LIB_FS.writeFileSync( path, Text );
	return path;
}


// A file with one data source written to disk, so a stop can be shown to have flushed it.
function jsonx_file( Folder, Name )
{
	return write_file( Folder, Name, JSON.stringify( {
		DataSources: [ { Name: 'Local', AdapterName: 'jsonstor-jsonfile', Settings: { Path: 'local.json' } } ],
	}, null, '\t' ) );
}


function new_processes( Options )
{
	return Processes.NewProcesses( Object.assign( {
		Spawn: LIB_CHILD_PROCESS.spawn,
		ExecPath: process.execPath,
	}, Options || {} ) );
}


async function post( Url, Body )
{
	let response = await fetch( Url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( Body ) } );
	return { Status: response.status, Body: await response.json() };
}


//---------------------------------------------------------------------
LIB_TEST.describe( 'Processes', function ()
{

	LIB_TEST.it( 'needs a Spawn and an ExecPath', function ()
	{
		LIB_ASSERT.throws( function () { Processes.NewProcesses( { ExecPath: process.execPath } ); }, /Spawn/ );
		LIB_ASSERT.throws( function () { Processes.NewProcesses( { Spawn: LIB_CHILD_PROCESS.spawn } ); }, /ExecPath/ );
	} );


	LIB_TEST.it( 'finds the jsonx command line it depends on', function ()
	{
		let bin = Processes.JsonxBin();
		LIB_ASSERT.strictEqual( LIB_FS.existsSync( bin ), true );
		LIB_ASSERT.strictEqual( LIB_PATH.basename( bin ), 'jsonx.js' );
	} );


	LIB_TEST.it( 'starts a process on a file and reads its ready line', async function ()
	{
		let folder = new_folder();
		let file = jsonx_file( folder, 'season.jsonx' );
		let processes = new_processes();
		try
		{
			let ready = await processes.Start( file );
			LIB_ASSERT.strictEqual( ready.File, file );
			LIB_ASSERT.match( ready.Url, /^http:\/\/127\.0\.0\.1:\d+$/ );
			LIB_ASSERT.strictEqual( ready.Ws, ready.Url.replace( 'http:', 'ws:' ) + '/ws' );
			LIB_ASSERT.strictEqual( ready.Ui, ready.Url + '/ui/' );
			LIB_ASSERT.strictEqual( typeof ready.Pid, 'number' );

			// It is the Web UI and the Web API, on the file which was named.
			let page = await fetch( ready.Ui );
			LIB_ASSERT.strictEqual( page.status, 200 );
			let answer = await post( ready.Url + '/datasource/list', {} );
			LIB_ASSERT.strictEqual( answer.Status, 200 );
			LIB_ASSERT.strictEqual( answer.Body.Ok, true );
			LIB_ASSERT.deepStrictEqual( answer.Body.Result, [ { Name: 'Local', AdapterName: 'jsonstor-jsonfile' } ] );
		}
		finally { await processes.StopAll(); }
	} );


	LIB_TEST.it( 'holds one process per file, however the file is named', async function ()
	{
		let folder = new_folder();
		let file = jsonx_file( folder, 'season.jsonx' );
		let processes = new_processes();
		try
		{
			let first = await processes.Start( file );
			let again = await processes.Start( LIB_PATH.join( folder, '.', 'season.jsonx' ) );
			LIB_ASSERT.strictEqual( again.Pid, first.Pid );
			LIB_ASSERT.strictEqual( processes.List().length, 1 );
			LIB_ASSERT.deepStrictEqual( processes.Lookup( file ), first );
			LIB_ASSERT.deepStrictEqual( processes.ByUi( first.Ui ), first );
			LIB_ASSERT.strictEqual( processes.ByUi( 'http://127.0.0.1:1/ui/' ), null );

			let other = jsonx_file( folder, 'other.jsonx' );
			let second = await processes.Start( other );
			LIB_ASSERT.notStrictEqual( second.Pid, first.Pid );
			LIB_ASSERT.notStrictEqual( second.Url, first.Url );
			LIB_ASSERT.strictEqual( processes.List().length, 2 );
		}
		finally { await processes.StopAll(); }
	} );


	LIB_TEST.it( 'answers a file which is not a jsonx file with the child exit code and its message', async function ()
	{
		let folder = new_folder();
		let file = write_file( folder, 'notes.jsonx', 'this is not JSON' );
		let processes = new_processes();
		try
		{
			await LIB_ASSERT.rejects(
				function () { return processes.Start( file ); },
				function ( Error_ )
				{
					LIB_ASSERT.strictEqual( Error_.name, 'ProcessError' );
					LIB_ASSERT.strictEqual( Error_.ExitCode, 3 );
					LIB_ASSERT.ok( Error_.Stderr.length > 0, 'the child said why' );
					return true;
				} );
			// Nothing is left behind, so the same file can be tried again.
			LIB_ASSERT.strictEqual( processes.Lookup( file ), null );
			LIB_ASSERT.strictEqual( processes.List().length, 0 );
		}
		finally { await processes.StopAll(); }
	} );


	LIB_TEST.it( 'stops a process the way Ctrl+C would, flushing what it holds', async function ()
	{
		let folder = new_folder();
		let file = jsonx_file( folder, 'season.jsonx' );
		let written = LIB_PATH.join( folder, 'local.json' );
		let processes = new_processes();
		try
		{
			let ready = await processes.Start( file );
			let inserted = await post( ready.Url + '/datasource/insert', { name: 'Local', documents: [ { _id: 'a', Night: 'clear' } ] } );
			LIB_ASSERT.strictEqual( inserted.Status, 200 );

			let outcome = await processes.Stop( file );
			LIB_ASSERT.strictEqual( outcome.Code, 0 );
			LIB_ASSERT.strictEqual( processes.Lookup( file ), null );
			LIB_ASSERT.strictEqual( LIB_FS.existsSync( written ), true, 'the data source was flushed' );
			LIB_ASSERT.match( LIB_FS.readFileSync( written, 'utf8' ), /clear/ );

			// Stopping something which is not running is not an error.
			LIB_ASSERT.strictEqual( await processes.Stop( file ), null );
		}
		finally { await processes.StopAll(); }
	} );


	LIB_TEST.it( 'reports a process which stops without being asked', async function ()
	{
		let folder = new_folder();
		let file = jsonx_file( folder, 'season.jsonx' );
		let exits = [];
		let processes = new_processes( { OnExit: function ( Path, Code, Stderr ) { exits.push( { Path: Path, Code: Code, Stderr: Stderr } ); } } );
		try
		{
			let ready = await processes.Start( file );
			process.kill( ready.Pid );

			// Wait for the exit to be seen.
			let waited = 0;
			while ( exits.length === 0 && waited < 5000 )
			{
				await new Promise( function ( Resolve ) { setTimeout( Resolve, 50 ); } );
				waited += 50;
			}
			LIB_ASSERT.strictEqual( exits.length, 1 );
			LIB_ASSERT.strictEqual( exits[ 0 ].Path, file );
			LIB_ASSERT.strictEqual( processes.List().length, 0 );
		}
		finally { await processes.StopAll(); }
	} );


	LIB_TEST.it( 'asks jsonx for a new file, which a process then opens with no error', async function ()
	{
		let folder = new_folder();
		let processes = new_processes();
		try
		{
			let text = await processes.Skeleton( 'Inventory' );
			let parsed = JSON.parse( text );
			LIB_ASSERT.strictEqual( parsed.Name, 'Inventory' );
			LIB_ASSERT.ok( parsed.DataSources.length > 0 && parsed.Objects.length > 0, 'the starter file, not an empty one' );

			// It is a file jsonx holds as it is: served, and its objects listed.
			let file = write_file( folder, 'Inventory.jsonx', text );
			let ready = await processes.Start( file );
			let objects = await post( ready.Url + '/query/list', {} );
			LIB_ASSERT.strictEqual( objects.Status, 200 );
			LIB_ASSERT.strictEqual( objects.Body.Ok, true );

			// A command line which fails is a ProcessError carrying what it said.
			let broken = new_processes( { Bin: write_file( folder, 'broken.js', 'process.stderr.write( "no skeleton" ); process.exit( 2 );\n' ) } );
			await LIB_ASSERT.rejects(
				function () { return broken.Skeleton( 'x' ); },
				function ( Error_ )
				{
					LIB_ASSERT.strictEqual( Error_.name, 'ProcessError' );
					LIB_ASSERT.strictEqual( Error_.ExitCode, 2 );
					LIB_ASSERT.strictEqual( Error_.Stderr, 'no skeleton' );
					return true;
				} );
		}
		finally { await processes.StopAll(); }
	} );


	LIB_TEST.it( 'gives up when no ready line comes', async function ()
	{
		let folder = new_folder();
		let file = jsonx_file( folder, 'season.jsonx' );
		// A program which says nothing and waits.
		let quiet = write_file( folder, 'quiet.js', 'setTimeout( function () {}, 60000 );\n' );
		let processes = new_processes( { Bin: quiet, ReadyMs: 400, StopMs: 400 } );
		try
		{
			await LIB_ASSERT.rejects(
				function () { return processes.Start( file ); },
				function ( Error_ )
				{
					LIB_ASSERT.strictEqual( Error_.name, 'ProcessError' );
					LIB_ASSERT.match( Error_.message, /did not say it was ready/ );
					return true;
				} );
			LIB_ASSERT.strictEqual( processes.List().length, 0 );
		}
		finally { await processes.StopAll(); }
	} );

} );
