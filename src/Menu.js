'use strict';

/*
	The application menu (cut 6 step 3), as data.

	***The menu is a template, not a pile of callbacks***: every item names an action, and `Actions` is
	what those names do. So a test can say that every action the menu names exists, and that nothing the
	app can do from the menu needs a window to reach.

	Electron's own items (`role`) are named rather than written: reload, the zoom items, developer tools,
	minimise and close all behave as the platform expects them to.
*/


//---------------------------------------------------------------------
/*
	Options:
		Recent      the recent files, newest first: [ { Path, At } ]
		Platform    'darwin' and so on; default process.platform
		Version     shown in Help
*/

function MenuTemplate( Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let platform = options.Platform || process.platform;
	let mac = ( platform === 'darwin' );
	let recent = Array.isArray( options.Recent ) ? options.Recent : [];

	let recent_items = recent.map( function ( Each )
	{
		return { label: Each.Path, Action: 'OpenPath', Argument: Each.Path };
	} );
	if ( recent_items.length === 0 )
	{
		recent_items.push( { label: 'Nothing yet', enabled: false } );
	}
	else
	{
		recent_items.push( { type: 'separator' } );
		recent_items.push( { label: 'Clear', Action: 'ClearRecent' } );
	}

	let template = [
		{
			label: '&File',
			submenu: [
				{ label: 'New...', accelerator: 'CmdOrCtrl+N', Action: 'NewFile' },
				{ label: 'Open...', accelerator: 'CmdOrCtrl+O', Action: 'OpenFile' },
				{ label: 'Open Recent', submenu: recent_items },
				{ type: 'separator' },
				{ label: 'Close Window', accelerator: 'CmdOrCtrl+W', role: 'close' },
				{ label: mac ? 'Quit' : 'Exit', accelerator: mac ? 'Cmd+Q' : 'Alt+F4', Action: 'Quit' },
			],
		},
		{
			label: '&View',
			submenu: [
				{ label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
				{ label: 'Developer Tools', accelerator: 'F12', role: 'toggleDevTools' },
				{ type: 'separator' },
				{ role: 'resetZoom' },
				{ role: 'zoomIn' },
				{ role: 'zoomOut' },
				{ type: 'separator' },
				{ role: 'togglefullscreen' },
			],
		},
		{
			label: '&Window',
			submenu: [
				{ role: 'minimize' },
				{ role: 'zoom' },
			],
		},
		{
			label: '&Help',
			submenu: [
				{ label: 'jsonx on the web', Action: 'OpenHomepage' },
				{ label: 'About jsonx' + ( options.Version ? ' ' + options.Version : '' ), Action: 'About' },
			],
		},
	];
	return template;
}


//---------------------------------------------------------------------
// Every action a template names, in the order they appear: for the test, and for wiring.

function ActionsNamed( Template )
{
	let names = [];
	function walk( Items )
	{
		( Items || [] ).forEach( function ( Each )
		{
			if ( Each.Action && !names.includes( Each.Action ) ) { names.push( Each.Action ); }
			if ( Each.submenu ) { walk( Each.submenu ); }
		} );
		return;
	}
	walk( Template );
	return names;
}


//---------------------------------------------------------------------
// The template with each Action turned into a click, ready for Electron's Menu.buildFromTemplate.

function WithActions( Template, Actions )
{
	function convert( Items )
	{
		return ( Items || [] ).map( function ( Each )
		{
			let item = Object.assign( {}, Each );
			if ( item.submenu ) { item.submenu = convert( item.submenu ); }
			if ( item.Action )
			{
				let action = Actions[ item.Action ];
				let argument = item.Argument;
				delete item.Action;
				delete item.Argument;
				if ( typeof action === 'function' ) { item.click = function () { return action( argument ); }; }
				else { item.enabled = false; }
			}
			return item;
		} );
	}
	return convert( Template );
}


//---------------------------------------------------------------------
module.exports = {
	MenuTemplate: MenuTemplate,
	ActionsNamed: ActionsNamed,
	WithActions: WithActions,
};
