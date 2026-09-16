'use strict';

/*
	The files opened lately (cut 6 step 3), newest first.

	-	***It is a list of paths and when each was opened***, kept as JSON beside the app's other settings
		(Electron's userData), so it survives the app being closed.
	-	***A file which is no longer there is dropped as the list is read***, not when it goes: nothing
		watches the disk, and a person asking for the list is the moment it matters.
	-	***Reading a list which is missing or damaged answers an empty one.*** A recent list is a
		convenience; it never stops the app starting.
	-	Everything it touches is a parameter (ReadFile, WriteFile, Exists, Now), so it is tested with no
		disk and no Electron.
*/

const LIB_PATH = require( 'path' );


const LIMIT = 10;


//---------------------------------------------------------------------
/*
	Options:
		Path        the file to keep the list in
		ReadFile    ( Path ) => text, or throws when it is not there; default fs.readFileSync
		WriteFile   ( Path, Text ); default fs.writeFileSync
		Exists      ( Path ) => boolean, for dropping files which are gone; default fs.existsSync
		Now         () => a Date; default Date.now
		Limit       how many to keep; default 10
*/

function NewRecent( Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let path = options.Path;
	if ( typeof path !== 'string' || path === '' ) { throw new Error( 'NewRecent needs a Path.' ); }

	let read_file = options.ReadFile || function ( Path ) { return require( 'fs' ).readFileSync( Path, 'utf8' ); };
	let write_file = options.WriteFile || function ( Path, Text ) { return require( 'fs' ).writeFileSync( Path, Text ); };
	let exists = options.Exists || function ( Path ) { return require( 'fs' ).existsSync( Path ); };
	let now = options.Now || function () { return Date.now(); };
	let limit = options.Limit || LIMIT;

	let recent = {};


	//---------------------------------------------------------------------
	// What is written down, whatever state it is in: never an error.

	function stored()
	{
		let text = null;
		try { text = read_file( path ); }
		catch ( error ) { return []; }
		let list = null;
		try { list = JSON.parse( text ); }
		catch ( error ) { return []; }
		if ( !Array.isArray( list ) ) { return []; }
		return list.filter( function ( Each ) { return Each && typeof Each.Path === 'string'; } );
	}


	//---------------------------------------------------------------------
	function save( List )
	{
		try { write_file( path, JSON.stringify( List, null, '\t' ) ); }
		catch ( error ) { /* a list which cannot be kept is still a list for this run */ }
		return;
	}


	//---------------------------------------------------------------------
	// Puts a file at the top, once, and keeps the newest few.

	recent.Add = function ( Path )
	{
		let resolved = LIB_PATH.resolve( Path );
		let list = stored().filter( function ( Each ) { return LIB_PATH.resolve( Each.Path ) !== resolved; } );
		list.unshift( { Path: resolved, At: new Date( now() ).toISOString() } );
		list = list.slice( 0, limit );
		save( list );
		return list;
	};


	//---------------------------------------------------------------------
	// The files still on disk, newest first. Ones which are gone are forgotten as they are found.

	recent.List = function ()
	{
		let list = stored();
		let kept = list.filter( function ( Each ) { return exists( Each.Path ); } );
		if ( kept.length !== list.length ) { save( kept ); }
		return kept;
	};


	//---------------------------------------------------------------------
	recent.Forget = function ( Path )
	{
		let resolved = LIB_PATH.resolve( Path );
		let list = stored().filter( function ( Each ) { return LIB_PATH.resolve( Each.Path ) !== resolved; } );
		save( list );
		return list;
	};


	recent.Clear = function ()
	{
		save( [] );
		return [];
	};

	recent.Path = path;
	return recent;
}


//---------------------------------------------------------------------
module.exports = {
	LIMIT: LIMIT,
	NewRecent: NewRecent,
};
