'use strict';

/*
	What a window may load, and whose calls are answered (cut 6 step 2).

	A window shows one file's own `jsonx` process, and the preload gives that page the host interface -
	which opens files, writes files and reads the clipboard. So the page must stay the page it was opened
	as:

	-	***A window navigates only within its own process's Web UI.*** Anything else - another origin,
		another file's process, a `file://` page - is refused and left to the operating system's browser.
	-	***A host call is answered only for the window whose own address it came from***, matched against
		what that window was opened with, so a page cannot ask on another file's behalf.
	-	***Both are plain functions over strings***: no Electron, no window, tested directly.
*/


//---------------------------------------------------------------------
// The origin and path of an address, or null when it is not one a window may be at.

function Parse( Address )
{
	if ( typeof Address !== 'string' || Address === '' ) { return null; }
	let url = null;
	try { url = new URL( Address ); }
	catch ( error ) { return null; }
	if ( url.protocol !== 'http:' && url.protocol !== 'https:' ) { return null; }
	return url;
}


//---------------------------------------------------------------------
// Is Address inside the Web UI a window was opened at? `Ui` is the ready line's Ui, ending in /ui/.

function WithinUi( Ui, Address )
{
	let base = Parse( Ui );
	let asked = Parse( Address );
	if ( !base || !asked ) { return false; }
	if ( asked.origin !== base.origin ) { return false; }
	return asked.pathname.startsWith( base.pathname );
}


//---------------------------------------------------------------------
// May this window go there? Its own Web UI, and nothing else.

function AllowNavigation( Ui, Address )
{
	return WithinUi( Ui, Address );
}


//---------------------------------------------------------------------
// Is this sender the window it claims to be? The page's address must be within the Ui it was opened at.

function SenderAllowed( Ui, SenderAddress )
{
	return WithinUi( Ui, SenderAddress );
}


//---------------------------------------------------------------------
module.exports = {
	Parse: Parse,
	WithinUi: WithinUi,
	AllowNavigation: AllowNavigation,
	SenderAllowed: SenderAllowed,
};
