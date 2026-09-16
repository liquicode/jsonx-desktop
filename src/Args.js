'use strict';

/*
	The files named on a command line (cut 6 step 2; a second instance's command line joins it in step 3).

	Electron hands over a command line whose shape depends on how the app was started: packaged, the
	program itself is first; unpackaged, the program is first and the app folder second. Switches can be
	anywhere, and Windows sends a path with no quotes once it is in `argv`.

	***Only a `.jsonx` file is taken from it***, so a stray argument never becomes a file to open.
*/

const LIB_PATH = require( 'path' );


const ENDING = '.jsonx';


//---------------------------------------------------------------------
// The .jsonx files on a command line, resolved, in the order they were given.

function FilesFromArgv( Argv, Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let argv = Array.isArray( Argv ) ? Argv : [];
	let skip = options.Packaged ? 1 : 2;
	let files = [];
	for ( let index = skip; index < argv.length; index++ )
	{
		let each = String( argv[ index ] );
		if ( each.startsWith( '-' ) ) { continue; }
		if ( !each.toLowerCase().endsWith( ENDING ) ) { continue; }
		files.push( LIB_PATH.resolve( options.Cwd || process.cwd(), each ) );
	}
	return files;
}


//---------------------------------------------------------------------
// The one file to open, or null: the first named.

function FileFromArgv( Argv, Options )
{
	let files = FilesFromArgv( Argv, Options );
	return ( files.length > 0 ) ? files[ 0 ] : null;
}


//---------------------------------------------------------------------
module.exports = {
	ENDING: ENDING,
	FilesFromArgv: FilesFromArgv,
	FileFromArgv: FileFromArgv,
};
