'use strict';

/*
	A `jsonx` process per open file (plan of record decision 10; build plan cut 6, step 1).

	-	***The desktop uses the command line and the protocols, never the library.*** `@liquicode/jsonx-cli`
		exports only `.` and `./package.json`, so its `modes/tui/Launch.js` cannot be reached from here. This
		is that idea rewritten against the readme's documented interface: `jsonx serve --ui --attached
		--port 0 --file <path>` writes one JSON line to standard output, `{ File, Url, Ws, Pid, Ui }`.
	-	***`--attached`***: the child stops when its standard input ends, so Stop ends it the way Ctrl+C
		would - data sources flushed and released - where a kill would flush nothing.
	-	***`--port 0`***: the child picks a free port and says which, so two files never collide.
	-	***A child which stops before its ready line*** is answered with its own exit code and standard
		error, so opening a file which is not a jsonx file says what `jsonx` would have said (exit 3).
	-	***Spawn and ExecPath are parameters***: under Electron the program is Electron's own binary with
		ELECTRON_RUN_AS_NODE=1 (measured 2026-09-15: Node 24.20.0, every native driver loading unrebuilt),
		and under `node --test` it is plain Node. Nothing here needs a window.
*/

const LIB_PATH = require( 'path' );
const LIB_READLINE = require( 'readline' );


const READY_MS = 15000;
const STOP_MS = 5000;


//---------------------------------------------------------------------
class ProcessError extends Error
{
	constructor( Message, ExitCode, Stderr )
	{
		super( Message );
		this.name = 'ProcessError';
		this.ExitCode = ( typeof ExitCode === 'number' ) ? ExitCode : 1;
		this.Stderr = Stderr || '';
	}
}


//---------------------------------------------------------------------
// The jsonx command line this package installs, found through the package it depends on rather than
// a path joined onto a folder (the workspace hoists node_modules).

function JsonxBin()
{
	let package_file = require.resolve( '@liquicode/jsonx-cli/package.json' );
	let manifest = require( package_file );
	let bin = ( typeof manifest.bin === 'string' ) ? manifest.bin : manifest.bin.jsonx;
	return LIB_PATH.join( LIB_PATH.dirname( package_file ), bin );
}


//---------------------------------------------------------------------
/*
	Options:
		Spawn       required, child_process.spawn
		ExecPath    required, the program to run the command line with
		Bin         the jsonx command line; default the installed one
		Env         the child's environment; default the desktop's, as Node
		ReadyMs     how long to wait for the ready line; default 15000
		StopMs      how long to wait for a stop before killing; default 5000
		OnExit      called ( Path, Code, Stderr ) when a child stops without being asked to
*/

function NewProcesses( Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	if ( typeof options.Spawn !== 'function' ) { throw new Error( 'NewProcesses needs a Spawn function.' ); }
	if ( typeof options.ExecPath !== 'string' || options.ExecPath === '' ) { throw new Error( 'NewProcesses needs an ExecPath.' ); }

	let bin = options.Bin || JsonxBin();
	let ready_ms = options.ReadyMs || READY_MS;
	let stop_ms = options.StopMs || STOP_MS;
	let processes = {};

	// Every file is known by its resolved path, so one file is one process however it was named.
	let started = new Map();


	//---------------------------------------------------------------------
	function key_of( Path )
	{
		return LIB_PATH.resolve( Path );
	}


	//---------------------------------------------------------------------
	// Starts a process on a file, or answers the one already running on it.

	function Start( Path )
	{
		let key = key_of( Path );
		let known = started.get( key );
		if ( known ) { return known.Starting; }

		let argv = [ bin, 'serve', '--ui', '--attached', '--port', '0', '--file', key ];
		let child = options.Spawn( options.ExecPath, argv, {
			cwd: LIB_PATH.dirname( key ),
			env: Object.assign( {}, options.Env || process.env, { ELECTRON_RUN_AS_NODE: '1' } ),
			stdio: [ 'pipe', 'pipe', 'pipe' ],
			windowsHide: true,
		} );

		let entry = {
			Path: key,
			Child: child,
			Ready: null,
			Stderr: '',
			Stopping: false,
			Starting: null,
			Exited: null,
		};
		started.set( key, entry );

		child.stderr.setEncoding( 'utf8' );
		child.stderr.on( 'data', function ( Chunk ) { entry.Stderr += Chunk; } );

		entry.Exited = new Promise( function ( Resolve )
		{
			child.once( 'exit', function ( Code, Signal )
			{
				started.delete( key );
				let outcome = { Code: Code, Signal: Signal };
				// A child which stopped on its own, after it was ready: the window wants to hear about it.
				if ( entry.Ready && !entry.Stopping && typeof options.OnExit === 'function' )
				{
					options.OnExit( key, ( typeof Code === 'number' ) ? Code : 1, entry.Stderr );
				}
				Resolve( outcome );
			} );
		} );

		entry.Starting = new Promise( function ( Resolve, Reject )
		{
			let lines = LIB_READLINE.createInterface( { input: child.stdout } );
			let settled = false;

			function settle_with_error( Error_ )
			{
				if ( settled ) { return; }
				settled = true;
				clearTimeout( timer );
				lines.close();
				entry.Stopping = true;
				Stop( key ).then( function () { Reject( Error_ ); }, function () { Reject( Error_ ); } );
			}

			let timer = setTimeout( function ()
			{
				settle_with_error( new ProcessError( 'jsonx serve did not say it was ready within ' + ready_ms + ' ms.', 1, entry.Stderr ) );
			}, ready_ms );

			lines.once( 'line', function ( Line )
			{
				if ( settled ) { return; }
				let ready = null;
				try { ready = JSON.parse( Line ); } catch ( error ) { ready = null; }
				if ( !ready || typeof ready.Ws !== 'string' || typeof ready.Ui !== 'string' )
				{
					settle_with_error( new ProcessError( 'jsonx serve wrote something other than its ready line: ' + Line, 1, entry.Stderr ) );
					return;
				}
				settled = true;
				clearTimeout( timer );
				lines.close();
				entry.Ready = ready;
				Resolve( ready );
			} );

			entry.Exited.then( function ( Outcome )
			{
				if ( settled ) { return; }
				settled = true;
				clearTimeout( timer );
				lines.close();
				let code = ( typeof Outcome.Code === 'number' ) ? Outcome.Code : 1;
				Reject( new ProcessError( 'jsonx serve stopped before it was ready (exit ' + code + ').', code, entry.Stderr ) );
			} );

			child.once( 'error', function ( Error_ )
			{
				if ( settled ) { return; }
				settled = true;
				clearTimeout( timer );
				lines.close();
				started.delete( key );
				Reject( new ProcessError( 'jsonx serve could not start: ' + Error_.message, 1, entry.Stderr ) );
			} );
		} );

		// A rejected start is the caller's to report; it must not also be an unhandled rejection.
		entry.Starting.catch( function () { return; } );
		return entry.Starting;
	}


	//---------------------------------------------------------------------
	// Ends the child's standard input and waits for it to stop; kills it if it will not.

	async function Stop( Path )
	{
		let key = key_of( Path );
		let entry = started.get( key );
		if ( !entry ) { return null; }
		entry.Stopping = true;

		if ( entry.Child.exitCode !== null || entry.Child.signalCode !== null ) { return await entry.Exited; }
		try { entry.Child.stdin.end(); } catch ( error ) { /* already closed */ }

		let timer = null;
		let waited = new Promise( function ( Resolve ) { timer = setTimeout( function () { Resolve( null ); }, stop_ms ); } );
		let outcome = await Promise.race( [ entry.Exited, waited ] );
		clearTimeout( timer );
		if ( outcome === null )
		{
			entry.Child.kill();
			outcome = await entry.Exited;
		}
		return outcome;
	}


	//---------------------------------------------------------------------
	async function StopAll()
	{
		let paths = Array.from( started.keys() );
		let outcomes = [];
		for ( let index = 0; index < paths.length; index++ )
		{
			outcomes.push( await Stop( paths[ index ] ) );
		}
		return outcomes;
	}


	//---------------------------------------------------------------------
	// What is running now: the ready line of each started process, by path.

	function Lookup( Path )
	{
		let entry = started.get( key_of( Path ) );
		if ( !entry || !entry.Ready ) { return null; }
		return entry.Ready;
	}

	function List()
	{
		let list = [];
		started.forEach( function ( Entry )
		{
			if ( Entry.Ready ) { list.push( Entry.Ready ); }
		} );
		return list;
	}

	// The process holding a page's address, so an IPC call can be answered only for its own window.
	function ByUi( Ui )
	{
		let found = null;
		started.forEach( function ( Entry )
		{
			if ( Entry.Ready && Entry.Ready.Ui === Ui ) { found = Entry.Ready; }
		} );
		return found;
	}


	//---------------------------------------------------------------------
	/*
		A new file's text: what `jsonx new file --name <Name>` writes to standard output, the skeleton jsonx-cli's
		readme starts a file from. A short-lived child, not a served one - nothing is held open for it.
	*/

	function Skeleton( Name )
	{
		return new Promise( function ( Resolve, Reject )
		{
			let child = options.Spawn( options.ExecPath, [ bin, 'new', 'file', '--name', String( Name ) ], {
				env: Object.assign( {}, options.Env || process.env, { ELECTRON_RUN_AS_NODE: '1' } ),
				stdio: [ 'ignore', 'pipe', 'pipe' ],
				windowsHide: true,
			} );
			let stdout = '';
			let stderr = '';
			child.stdout.setEncoding( 'utf8' );
			child.stderr.setEncoding( 'utf8' );
			child.stdout.on( 'data', function ( Chunk ) { stdout += Chunk; } );
			child.stderr.on( 'data', function ( Chunk ) { stderr += Chunk; } );
			child.once( 'error', function ( Error_ ) { Reject( new ProcessError( 'jsonx new could not start: ' + Error_.message, 1, stderr ) ); } );
			child.once( 'close', function ( Code )
			{
				let code = ( typeof Code === 'number' ) ? Code : 1;
				if ( code !== 0 ) { Reject( new ProcessError( 'jsonx new stopped with exit ' + code + '.', code, stderr ) ); return; }
				Resolve( stdout );
			} );
		} );
	}


	//---------------------------------------------------------------------
	processes.Bin = bin;
	processes.Skeleton = Skeleton;
	processes.Start = Start;
	processes.Stop = Stop;
	processes.StopAll = StopAll;
	processes.Lookup = Lookup;
	processes.List = List;
	processes.ByUi = ByUi;
	return processes;
}


//---------------------------------------------------------------------
module.exports = {
	READY_MS: READY_MS,
	STOP_MS: STOP_MS,
	ProcessError: ProcessError,
	JsonxBin: JsonxBin,
	NewProcesses: NewProcesses,
};
