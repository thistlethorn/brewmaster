// utils/tonyDialogue.js

const dialogue = {
	// --- handleLeave ---
	leave_notInGuild_title: [
		'❌ Not in a Guild',
		'❌ Hold Your Horses',
		'❌ Thinkin\' Ahead, Are We?',
	],
	leave_notInGuild_desc: [
		'Hey, nobody\'s quittin\' a crew if they ain\'t officially in. Rules are rules, pal. Don\'t make me remind ya.',
		'Listen, pal, you gotta be part of the family before you can make moves like that. Tryna leave a guild you not even in... you stupid or somethin?',
		'You can\'t get fired from a job you never had, friend. You gotta be *in* a guild to leave one. Simple as that.',
		'Whoa there, slow down. You\'re trying to quit a club you haven\'t even joined. Let\'s start with step one, eh?',
	],
	leave_isOwner_title: [
		'👑 Ownership Duty',
		'👑 The Boss Can\'t Just Walk',
		'👑 Heavy is the Crown',
	],
	leave_isOwner_desc: [
		(name, tag) => `Hey, you're the big boss of **${name} [${tag}]**. You forgot or somethin? You gotta pass the crown or shut it down before you even think about walkin' away.`,
		(name, tag) => `Look, you the one runnin' **${name} [${tag}]**, so either hand off the keys to someone else or close shop before you bounce, got it?`,
		(name, tag) => `The captain goes down with the ship, or at least finds a new captain. You're at the helm of **${name} [${tag}]**. Can't just abandon your post.`,
		(name, tag) => `This ain't just a title, it's a responsibility. Pass the torch or burn the place down. You can't just walk away from **${name} [${tag}]**.`,
	],
	leave_departed_title: [
		'👋 A Member has Departed',
		'👋 Roster Change',
		'👋 One Less Chair at the Table',
	],
	leave_departed_desc: [
		(user, name, tag) => `Alright, listen up everyone: ${user} just stepped outta the **${name} [${tag}]** crew. Watch out! They'll be makin' their own moves now.`,
		(user, name, tag) => `Well well well! ${user} finally decided to cut ties with **${name} [${tag}]**. Say it ain't so!`,
		(user, name, tag) => `Let the record show, ${user} is no longer flying the banner of **${name} [${tag}]**. Their tab is closed.`,
		(user, name, tag) => `The winds of change are blowin'. ${user} has chosen to walk a different path, away from **${name} [${tag}]**.`,
	],
	leave_success_title: [
		'✅ Left Guild',
		'✅ You\'re a Free Agent',
		'✅ Ties Severed',
	],
	leave_success_desc: [
		(name, tag) => `Alright, you're off the books now. You've successfully slipped outta **${name} [${tag}]**. No hard feelings... right?`,
		(name, tag) => `Well, looks like you've made your exit, clean and smooth. No more ties to **${name} [${tag}]** for you now.`,
		(name, tag) => `The deed is done. Your name's been struck from the roster of **${name} [${tag}]**. You're a free agent now.`,
		(name, tag) => `Consider your ties officially severed. You've successfully parted ways with **${name} [${tag}]**. Good luck out there.`,
	],
	leave_error_title: [
		'❌ Error Leaving Guild',
		'❌ Paperwork Got Jammed',
		'❌ A Complication',
	],
	leave_error_desc: [
		'Hey, somethin\' went sideways tryin\' to leave the crew. Don\'t worry, the Innkeepers got the message. They\'ll sort it out, no sweat.',
		'Well, I\'ll be damned! Looks like there was a hitch with your exit from the guild. The Innkeepers are on it, trust me. They don\'t take these things lightly.',
		'The paperwork got jammed on your way out. It happens. The higher-ups are lookin\' into it, so just sit tight.',
		'Someone threw a wrench in the works. We couldn\'t process your departure, but the Innkeepers have been alerted to the... complication.',
	],

	// --- handleInvite ---
	invite_notInGuild_title: [
		'❌ Not in a Guild',
		'❌ Who Are You With?',
		'❌ An Empty Invitation',
	],
	invite_notInGuild_desc: [
		'What, you tryna invite folks into nothing? You not part of any crew, pal.',
		'How bout you first join a guild before you try adding a pal of yours into the family, bud?',
		'You\'re sellin\' tickets to a show that ain\'t even built yet. Join a guild, *then* you can hand out invitations.',
		'You gotta have a house before you can invite people over for dinner. Find a crew to call your own first.',
	],
	invite_targetInGuild_title: [
		'❌ Already in a Guild',
		'❌ They\'re Already Taken',
		'❌ Poaching? Not on My Watch.',
	],
	invite_targetInGuild_desc: [
		(user) => `Hold up, ${user} is already sittin' pretty in another crew. Gotta say goodbye to the old family before joinin' a new one, capiche?`,
		(user) => `Hey, ${user} ain't a free agent, they still in another guild. Gotta drop the old ties before makin' new ones.`,
		(user) => `That one's already flying another crew's colors. ${user} has to be a lone wolf before they can join your pack.`,
		(user) => `Looks like ${user} already signed a contract with another outfit. They gotta get outta that deal before they can sign a new one with you.`,
	],
	invite_embed_title: [
		(name, tag) => `⚔️ Guild Invitation: ${name} [${tag}]`,
		(name, tag) => `⚔️ An Offer From ${name} [${tag}]`,
		(name, tag) => `⚔️ You've Been Summoned by ${name} [${tag}]`,
	],
	invite_embed_desc: [
		'Word on the street? This here\'s a promising crew lookin\' for fresh faces, and they want you in. Think you got what it takes to roll with \'em?',
		'Ah, good I caught ya! There\'s a new guild on the block raisin\' its flag. Seems they\'re lookin\' for some solid allies, and they asked about\'cha, so you in or out?',
		(name) => `Opportunity's knockin', friend. The folks over at **${name}** think you've got potential. They're extending a hand. You gonna shake it or leave 'em hangin'?`,
		(name) => `Psst, over here. Some important people from **${name}** have been asking about you. They see something they like. This is your chance to get in on the ground floor.`,
	],

	// --- announceNewMember ---
	announce_newHero_title: [
		'🎉 A New Hero Arrives! 🎉',
		'🎉 New Blood!',
		'🎉 Pull Up a Chair!',
	],
	announce_newHero_desc: [
		(user) => `Alright everyone, give a big, loud welcome to our newest family member, ${user}!`,
		(user) => `Hey, listen up! Let's roll out the red carpet for ${user}!`,
		(user) => `Raise a glass, everyone! We've got new blood! Let's hear it for ${user}!`,
		(user) => `Pull up a chair, there's a new name at our table! A warm welcome to ${user}!`,
	],
	announce_newHero_value: [
		(name) => `You're officially part of the ${name} crew! Glad to have ya struttin' through our public square!`,
		(name) => `Fresh off the boat and into ${name}! We're buzzin' to have you hangin' with us in the heart of our guildhall!`,
		(name) => `The newest face in ${name}!`,
		'Glad to have you with us.',
	],
	announce_globalJoin_title: [
		'✅ New Guild Member',
		'✅ The Ranks Swell',
		'✅ Roster Updated',
	],
	announce_globalJoin_desc: [
		(user, name, tag) => `Official word, fellas: ${user} has been welcomed into the ranks of **${name} [${tag}]**! Got the feeling their bond'll be as strong as family!`,
		(user, name, tag) => `Listen up, folks: ${user} has entered the fold of **${name} [${tag}]**. Expectin' great things from this one!`,
		(user, name, tag) => `Let the record show that ${user} is now under the protection and banner of **${name} [${tag}]**. Welcome to the family.`,
		(user, name, tag) => `A new name has been added to the roster. ${user} is now officially a member of **${name} [${tag}]**.`,
	],

	// --- handleCreate ---
	create_failed_title: [
		'❌ Guild Creation Failed',
		'❌ Back to the Drawing Board',
		'❌ Hit a Snag',
	],
	create_badTag_desc: [
		'Hey, rules are rules, pally pal, your guild tag\'s gotta be three letters, all uppercase. No wiggle room, capisce?',
		'Listen, bud, I don\'t make the rules, I just enforce \'em: three big, bold letters for your tag. No more. No less.',
		'I ain\'t a mathematician, but I can count to three. Your tag can\'t. Fix it.',
		'The sign on the door\'s gotta be three letters, boss. That\'s the house rule. Make it sharp, make it uppercase.',
	],
	create_badName_desc: [
		'Easy there, kid, keep it simple. Guild names only take letters, numbers, and a lil\' breathing room in between. No funny business.',
		'Wow, wow, you gettin\' over excited here, pal. Your guild name\'s gotta stick to letters, numbers, and spaces. Save the fancy symbols for a love letter.',
		'Keep all that fancy script for your poetry books. The ledger only takes straight letters, numbers, and spaces. Keep it clean.',
		'You tryin\' to write in some secret code? Nah. It\'s letters, numbers, and spaces, or it\'s nothin\'. End of story.',
	],
	create_badLength_desc: [
		'Alright, let\'s not get carried away, kid, your guild name\'s gotta be between 3 and 35 characters. Short \'n sweet, you feel me?',
		'Look, pal, we need somethin\' that fits on the ledger. Guild name\'s gotta land between 3 and 35 characters. We\'re not writin\' a novel here.',
		'Slow your roll here, Geronimo! It\'s a guild name, not your life story, fer crying out loud. Keep it between 3 and 35 characters, y\'hear?',
		'This ain\'t Goldilocks, pal. Not too short, not too long. Between 3 and 35. Get it right.',
	],
	create_reservedName_desc: [
		(terms) => `Whoa there, that name's got some words we keep off the books. Try somethin' classier, alright? None of this: ${terms}. I better not catch you tryin' to pull somethin' off like that again, you hear me?`,
		(terms) => `Ehhh, that one's not gonna fly. You're usin' terms that don't sit right with me and the higher-ups. You best steer clear of: ${terms}. Don't make me remind you again.`,
		(terms) => `You're walking on thin ice with that name. Pick another one before you fall in. Stay away from these words: ${terms}.`,
		(terms) => `Some words are bad for business, see? And you picked one. Choose a name that doesn't use stuff like: ${terms}.`,
	],
	create_alreadyInGuild_desc: [
		(name, tag) => `Gotta slow down there, Mr. 'wannabe boss'. You're already part o' **${name} [${tag}]**. Gotta tie up those loose ends before buildin' somethin' new and makin' your own guild, capisce?`,
		(name, tag) => `Hold up there, pally-pal! You're still on the books with **${name} [${tag}]**. Gotta step outta that crew before startin' your own.`,
		(name, tag) => `One family at a time, friend. Settle your business with **${name} [${tag}]** before you go startin' a new one.`,
		(name, tag) => `Tryin' to run two crews at once? That's bad for your health. Leave **${name} [${tag}]** first, then we can talk.`,
	],
	create_tagTaken_desc: [
		(tag) => `Eh, tough break, [${tag}]'s already claimed by another guild. You'll need to cook up somethin' new, alright?`,
		(tag) => `No luck, friend, [${tag}] is off the table. Some other guild beat ya to it. Best get creative now, eh?`,
		(tag) => `That tag, [${tag}], is already stitched on another crew's banner. You're late. Back to the drawing board.`,
		(tag) => `Someone's already making a name for themselves with [${tag}]. Think of something more original.`,
	],
	create_success_title: [
		(name, tag) => `🏰 Guild "${name}" [${tag}] Created!`,
		(name, tag) => `🏰 Welcome to the Big Leagues, "${name}" [${tag}]!`,
		(name, tag) => `🏰 The Birth of "${name}" [${tag}]!`,
	],
	create_success_desc: [
		'And just like that! Your own guild\'s officially on the map. Congrats, new boss!',
		'Well, look at you, makin\' moves! Your new guild\'s all set up and ready to roll. Nice work!',
		(name) => `The ink is dry, the papers are signed. Your guild, **'${name}'**, is official. Don't mess it up.`,
		'Welcome to the big leagues, boss. Your guild is born. Let\'s see what you\'re made of.',
	],
	create_globalAnnounce_title: [
		'🏰 A New Guild has been Founded!',
		'🏰 Another Flag Flies!',
		'🏰 A New Power Rises!',
	],
	create_globalAnnounce_desc: [
		(name, tag, user) => `Alright, listen up, everyone: **${name} [${tag}]** now stands tall, established by Guildmaster ${user}. Here's to fame, fortune, and a legacy worth rememberin'! Cheers!`,
		(name, tag, user) => `Word goes out: **${name} [${tag}]** has been founded under the watchful eye of Guildmaster ${user}. Watch out, their name just may echo far and wide...`,
		(name, tag, user) => `Hear ye, hear ye! A new power rises in our midst! **${name} [${tag}]**, led by the ambitious ${user}, has entered the game.`,
		(name, tag, user) => `Another flag flies over the tavern today. **${name} [${tag}]** has been founded by ${user}. May their coffers stay full and their enemies tremble.`,
	],
	create_publicChannelWelcome: [
		(name, tag, user) => `Gather 'round, folks, for a grand welcome to the public square of **${name} [${tag}]**! Built brick by brick by none other than ${user}!`,
		(name, tag, user) => `Step right up, new faces, and enter the heart of **${name} [${tag}]**, founded by ${user}! Respect the grounds, mingle wise, and make yourselves at home!`,
		(name, tag, user) => `Let it be known, this space now belongs to **${name} [${tag}]**. The first brick was laid by ${user}. Don't scuff the floors.`,
		(name, tag, user) => `This here is the public square of **${name} [${tag}]**. Founded by the vision of ${user}. All are welcome, but watch your step.`,
	],
	create_error_title: [
		'❌ Guild Creation Error',
		'❌ Construction Halted',
		'❌ Something Fell Apart',
	],
	create_error_desc: [
		'Well, that didn\'t go as planned. The guild didn\'t take, but we tidied up what was left behind, so no worries there, pal. Try again in a bit. Sometimes I swear the ledger\'s just got a mood of its own.',
		'Looks like somethin\' went sideways while settin\' up your guild. But don\'t worry, kid, we cleaned up the mess. Give it another go when the stars align o\' somethin\', alright?',
		'The whole thing fell apart. A real shame. We swept up the broken pieces, so you can try again when you\'ve got your ducks in a row.',
		'Something went wrong with the construction, a critical failure. We\'ve reset everything. Give it some time, then try building again.',
	],

	// --- handleDelete ---
	delete_notAllowed_title: [
		'❌ Action Not Allowed',
		'❌ Hands Off, Pal',
		'❌ Above Your Paygrade',
	],
	delete_notAllowed_desc: [
		'Eh, eh, there! Only the big boss gets to shut down the operation. If your name ain\'t the one on the ledger, you\'re not swingin\' the hammer on that guild, pal. And don\'t make me remind you again.',
		'Listen, champ, takin\' down a guild ain\'t something anyone can do. That kinda call comes from the top, and we both know that ain\'t you, so step back from the big red button and don\'t try no funny business again, got it?',
		'Hold on there, pal. Only the boss gets to call the shots on shuttin\' down the whole operation. That ain\'t you.',
		'Whoa, whoa, easy there. You think you can just waltz in and tear down the walls? Only the Guildmaster holds the key to that kinda destruction.',
	],
	delete_confirm_title: [
		'⚠️ Confirm Deletion',
		'⚠️ You Sure About This?',
		'⚠️ No Goin\' Back',
	],
	delete_confirm_desc: [
		(name, tag) => `You really wanna whack **${name} [${tag}]** off the map? All the channels, role, the whole legacy... Gone. No backsies, no take-two. You sure about this, bud?`,
		(name, tag) => `This is a big decision, pal. Deletin' **${name} [${tag}]** means burnin' it to the ground. Channels, role, history... Poof! And once it's done, it's done. You sure you ready for that?`,
		(name) => `You sure about this? Once you pull this lever, **${name}** becomes nothin' but a memory. No goin' back. Think hard.`,
		(name, tag) => `This is it, the final call. You hit that button, and **${name} [${tag}]** and everything it stands for... poof. Gone for good. You ready for that?`,
	],
	delete_notForYou_title: [
		'❌ Not for You',
		'❌ Button Ain\'t Yours',
		'❌ Not Your Call',
	],
	delete_notForYou_desc: [
		'This kinda call\'s above your paygrade, pal. Guild owner\'s the only one who can greenlight somethin\' like this, capisce?',
		'Whoa, whoa, there! Only the big boss gets to give the final word on this one. And that ain\'t you, bud.',
		'Hey, hands off! This button\'s got the boss\'s name on it, not yours. Go find somethin\' else to poke.',
		'This ain\'t your decision to make, friend. The Guildmaster\'s the only one who can sign off on this. Move along.',
	],
	delete_globalAnnounce_title: [
		'🗑️ A Guild has Disbanded',
		'🗑️ Another One Bites The Dust',
		'🗑️ End of an Era',
	],
	delete_globalAnnounce_desc: [
		(name, tag) => `And just like that: **${name} [${tag}]** is no more. The boss made the call. Banners down, doors closed. It's history now.`,
		(name, tag) => `It's official: **${name} [${tag}]**'s been laid to rest by its owner. Its banners came down, and its square's now gone for good.`,
		(name, tag) => `Well, that's a wrap. The owner's called it quits on **${name} [${tag}]**. Lower the flags, boys. Another one bites the dust.`,
		(name, tag) => `It's official. The boss has disbanded **${name} [${tag}]**. A quiet end to their story. Pour one out.`,
	],
	delete_success_title: [
		'🗑️ Guild Deleted',
		'🗑️ Wiped Clean',
		'🗑️ The Deed Is Done',
	],
	delete_success_desc: [
		(name, tag) => `It's done. **${name} [${tag}]**'s been wiped clean. Like it was never even there. Sad to cross this one off the ledger...`,
		(name, tag) => `All gone... **${name} [${tag}]** has officially been closed up for good. No mess, no loose ends...`,
		(name, tag) => `Alright, the deed is done. **${name} [${tag}]** has been wiped from the map. Clean slate.`,
		(name, tag) => `It's finished. You've successfully dismantled **${name} [${tag}]**. Hope you knew what you were doin'.`,
	],
	delete_error_title: [
		'❌ Deletion Error',
		'❌ Somethin\' Went Sideways',
		'❌ A Wrench in the Works',
	],
	delete_error_desc: [
		'Huh... Somethin\' went sideways while tryin\' to pull the plug on your guild. Give it a breather and try again in a bit, alright?',
		'Well... That didn\'t go as planned. The guild\'s still standin\'. Just give it a moment and try again later, yeah?',
		'Somethin\' got stuck in the gears while tryin\' to tear it all down. Don\'t worry, nothin\' broke for good. Give it another try in a bit.',
		'Hit a snag tryin\' to delete the guild. The ledgers are a mess. We\'ve put things back for now, but you\'ll have to try again later.',
	],
	delete_cancelled_title: [
		'🚫 Deletion Cancelled',
		'🚫 Pulled Back From the Edge',
		'🚫 Second Thoughts, Eh?',
	],
	delete_cancelled_desc: [
		'Changed your mind, huh? No worries, kid, the guild\'s still standin\'. Nothing\'s been torched.',
		'Looks like someone had second thoughts: the guild lives to see another day.',
		'Alright, you pulled back from the edge. Deletion\'s off the table. The guild lives to see another day.',
		'Changed your mind, eh? Smart move. The deletion process has been stopped. Business as usual.',
	],
	delete_timeout_title: [
		'⏱️ Timed Out',
		'⏱️ Clock\'s Up',
		'⏱️ You Snoozed...',
	],
	delete_timeout_desc: [
		'Clock ran out before you made the call. The guild\'s still standin\'.',
		'Time\'s up and I got no word back, so the guild\'s still kickin\'.',
		'Took too long to decide, pal. Time\'s up. The guild wasn\'t deleted. Maybe next time, make up your mind faster.',
		'You snoozed, you... didn\'t lose the guild. Confirmation timed out. Nothin\'s changed. We\'re not here all day, you know.',
	],

	// --- handleRaidMessagesSettings ---
	raidmsg_allSet_title: [
		'✅ All Set!',
		'✅ Lookin\' Good!',
		'✅ Ahead of the Game!',
	],
	raidmsg_allSet_desc: [
		'Looks like you\'re all set: raid messages are already dressed up nice and proper. Wanna tweak \'em some more? Hit up "View & Manage All".',
		'You\'re all done, bud: your raid messages got the VIP treatment already. To change them some more, just slide over to "View & Manage All".',
		'Looks like you\'re already ahead of the game, boss. All your raid messages are one-of-a-kind. Nothin\' for me to do here.',
		'Well, look at you, a regular wordsmith. Every message is already custom. If you wanna make changes, you know where to find the manager.',
	],
	raidmsg_guidedStart_desc: [
		'Alright, lil boss, we\'re kickin\' off the guided setup for your raid messages. Let\'s get this show on the road.',
		'Time to walk you through setting up those raid messages. Nice and easy. Just follow my lead.',
		'Alright, let\'s get this done. I\'ll walk you through setting up your raid messages, one by one. Pay attention.',
		'Time to make your mark. Let\'s get these raid messages configured so your enemies know exactly who they\'re dealin\' with.',
	],
	raidmsg_complete_title: [
		'✅ Configuration Complete!',
		'✅ All Done!',
		'✅ That\'s a Wrap!',
	],
	raidmsg_complete_desc: [
		'Every default message? Checked and double-checked. Nothing slips past us.',
		'Alright, alright! Every default message got the once-over. We\'re good to go!',
	],
	raidmsg_updated_desc: [
		(title) => `Alright, **${title}** is all set. Looks good.`,
		(title) => `Okay, I've updated the script for **${title}**. Solid choice.`,
	],
	raidmsg_exit_desc: [
		'Alright, we\'re callin\' it a wrap. Steppin\' outta the editor now.',
		'Editor\'s all closed now. Hope you did all you wanted there.',
	],
	raidmsg_skipped_desc: [
		'Skipped this one big time. No time to waste, movin\' on to the next message.',
		'Yea, this one\'s a pass. Looking at the next message, now.',
	],
	raidmsg_timeout_desc: [
		'⏱️ Clock ran out on ya. Take two to get ready and start the command again, kid.',
		'⏱️ Time\'s up, friend. Give it another shot with the command but be quicker this time.',
	],

	// --- handleGuildFund ---
	fund_failed_title: [
		'❌ Failed to Fund Guild!',
		'❌ Funding Fell Through',
		'❌ Hit a Snag',
	],
	fund_insufficient_name: [
		'💸 You can only fund your guild with Crowns than you own!',
		'💸 Big Spender... of Crowns You Don\'t Have!',
	],
	fund_insufficient_value: [
		(amount, diff) => `Tryin' to toss in ${amount.toLocaleString()} Crowns? You're short ${diff.toLocaleString()}. Maybe check your wallet first before makin' promises, eh?`,
		(amount, diff) => `You wanna drop ${amount.toLocaleString()} Crowns, but you're missin' ${diff.toLocaleString()}. I respect the ambition, though, so how 'bout you go and earn them missing Crowns now and try that after?`,
	],
	fund_success_name: [
		'🏛️ Funding Guild Success!',
		'🏛️ Now That\'s What I Call Contributin\'!',
	],
	fund_success_value: [
		(amount, name, tag) => `✅ Look at you, tossin' in ${amount.toLocaleString()} Crowns to **${name} (${tag})**. That's the kinda loyalty we like to see.`,
		(amount, name, tag) => `✅ ${amount.toLocaleString()} Crowns straight into the vault of **${name} [${tag}]**. You just earned yourself some respect, friend.`,
	],
	fund_error_name: [
		'Guild Funding Error - Database Rolled Back.',
		'No Luck on the Funding... Books Didn\'t Balance.',
	],
	fund_error_value: [
		'❌ Somethin\' went sideways with the books. We rolled it all back, so nothin\'s lost, don\'t you worry. Just try again later, alright?',
		'❌ We had a hiccup movin\' your Crowns around. Don\'t worry, though, it\'s all cleaned it up. Simply give it another go when you\'re ready.',
	],
};

/**
 * Gets a random piece of dialogue from the collection.
 * @param {string} key The key for the dialogue set.
 * @param  {...any} args Any arguments to pass to the dialogue function.
 * @returns {string} A randomly selected and formatted dialogue string.
 */
function getTonyQuote(key, ...args) {
	const quoteSet = dialogue[key];
	if (!quoteSet || quoteSet.length === 0) {
		console.error(`[Tony Dialogue] No quote found for key: ${key}`);
		return '...';
	}

	const randomIndex = Math.floor(Math.random() * quoteSet.length);
	const randomQuote = quoteSet[randomIndex];

	if (typeof randomQuote === 'function') {
		return randomQuote(...args);
	}
	return randomQuote;
}

module.exports = { getTonyQuote };