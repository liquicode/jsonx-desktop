'use strict';

/*
	The desktop's side of the host interface (jsonx-cli's types/jsonx-host.d.ts, cut 6 step 2).

	The page asks for what only its host can give, and shows a control only for a capability the host
	lists - so the Web UI is never forked, and a capability added here appears in the page by itself.
	This module is what each capability does; `main/preload.js` is how the page reaches it, and
	`main/main.js` hands both the pieces of Electron they use.

	-	***Electron's pieces are parameters*** (Dialog, Clipboard, Notification, WriteFile, Windows), so
		every capability is tested with stubs and no window.
	-	***A capability the host was not given is not listed***, which is how step 2 provides three of the
		six: what is missing is simply absent from the page.
	-	***Each answer is a promise of true or false***, false meaning the person cancelled or the host
		could not - never an exception the page has to catch.

	Step 3 adds OpenFile and RecentFiles, and step 4 OpenTerminal.
*/

const LIB_PATH = require( 'path' );


const KIND = 'desktop';


//---------------------------------------------------------------------
/*
	Options:
		Dialog          Electron's dialog, for SaveText
		Clipboard       Electron's clipboard, for CopyText
		Notification    Electron's Notification class, for Notify
		WriteFile       async ( Path, Text ); default fs.promises.writeFile
		WindowFor       optional, ( ) => the BrowserWindow a dialog belongs to
*/

function NewHost( Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let host = {};

	host.Kind = KIND;


	//---------------------------------------------------------------------
	// Tells the person something outside the page: only when the system will show it.

	if ( options.Notification )
	{
		host.Notify = async function ( Title, Text )
		{
			let Notification_ = options.Notification;
			if ( typeof Notification_.isSupported === 'function' && !Notification_.isSupported() ) { return false; }
			try
			{
				let notification = new Notification_( { title: String( Title ), body: String( Text || '' ) } );
				notification.show();
				return true;
			}
			catch ( error ) { return false; }
		};
	}


	//---------------------------------------------------------------------
	if ( options.Clipboard )
	{
		host.CopyText = async function ( Text )
		{
			try
			{
				options.Clipboard.writeText( String( Text ) );
				return true;
			}
			catch ( error ) { return false; }
		};
	}


	//---------------------------------------------------------------------
	// Asks where to put the text, and writes it. Cancelled is false, not an error.

	if ( options.Dialog )
	{
		host.SaveText = async function ( SuggestedName, Text )
		{
			let name = String( SuggestedName || 'jsonx.json' );
			let request = {
				defaultPath: name,
				filters: [
					{ name: 'JSON', extensions: [ 'json' ] },
					{ name: 'All files', extensions: [ '*' ] },
				],
			};
			try
			{
				let window_ = ( typeof options.WindowFor === 'function' ) ? options.WindowFor() : null;
				let chosen = window_
					? await options.Dialog.showSaveDialog( window_, request )
					: await options.Dialog.showSaveDialog( request );
				if ( !chosen || chosen.canceled || !chosen.filePath ) { return false; }
				let write = options.WriteFile || require( 'fs' ).promises.writeFile;
				await write( chosen.filePath, String( Text ) );
				return true;
			}
			catch ( error ) { return false; }
		};
	}


	//---------------------------------------------------------------------
	// The names the page may show a control for: every capability this host was given.

	host.Capabilities = function ()
	{
		let names = [];
		Object.keys( host ).forEach( function ( Name )
		{
			if ( Name === 'Capabilities' ) { return; }
			if ( typeof host[ Name ] === 'function' ) { names.push( Name ); }
		} );
		return names;
	};

	return host;
}


//---------------------------------------------------------------------
// A name to suggest for a file saved out of a file's page: the file's own name, with a new ending.

function SuggestedName( FilePath, Ending )
{
	let base = LIB_PATH.basename( String( FilePath || 'jsonx' ) );
	let dot = base.lastIndexOf( '.' );
	if ( dot > 0 ) { base = base.slice( 0, dot ); }
	return base + '.' + String( Ending || 'json' );
}


//---------------------------------------------------------------------
module.exports = {
	KIND: KIND,
	NewHost: NewHost,
	SuggestedName: SuggestedName,
};
