# Brewmaster Discord Bot

Brewmaster is a custom-coded, multifunctional Discord.js bot designed exclusively for the **Westwind Tavern**... ahem, shall I call it, *Tony's* palace. While the wires underneath lead him to be called Brewmaster, the frontman running the show up top is **Tony "Meatball", the Brewmaster**. He's a friendly tavern keeper, if a bit... direct. As he'd say, *"Listen up, folks: We got rules, we got games, and we got opportunities. Don't be a stranger, capisce?"*

Tony's primary goal as the Brewmaster for Westwind Tavern: Creating a dynamic, engaging, and rewarding experience for all server members by integrating unique economy, guild warfare, and character progression systems directly into the Discord environment.

## About the Westwind Tavern

The Westwind Tavern is more than just a server; it's a community hub for friends and family, whether you're decades deep into TTRPGs or fresh on the block, there's always a spot for you here.

*   **Gamefinding & Hosting**: Are you a Dungeon Master looking for players, or a player searching for a new adventure? The Tavern provides free, dedicated gamerooms (and free VCs to boot!) as well as being a central place to post and find games for D&D, Pathfinder, and any other TTRPG system.
*   **Welcoming Community**: It's an all-inclusive space for everyone to make new friends, have fun, show off dice collections and miniatures, and share resources.
*   **Engaging Events**: The server hosts weekly video game nights, Role-Playing/OLARP sessions, and Karaoke nights to keep the fun going outside of the TTRPG campaigns.
*   **Close-Knit Community**: We're more than just dead chats and lurkers here. Everyone here on the server really gets to know eachother, and we're here for genuine connections. You'll find as soon as you come in, it's easy to jump on into any of the random sparked conversations going on. We'd love to meet you, and add you to our friend circle! So.....

[**Come pull up a chair and join the Westwind Tavern!**](https://dsc.gg/westwindtavern)

*"Here's anotha' day where the flag flies high above the tav'. Step right up, new faces, and enter the heart of the Westwind Tavern! But you'd best respect the grounds, mingle wise, then make yourselves at home!”* - Tony

---

## Core Features

Brewmaster is packed with features designed to enrich the Westwind Tavern community. Or, as Tony would probably say while slicking back his hair, *"We can't be showin' up to the party lookin' stupid, huh? We gotta keep up appearances."*

### 🏰 Guild System (AKA Tony's World)
Well, you heard it here first, folks. In the server, you'll need a guild to help yourself earn more money on the daily, boost yourself with passive income, and create alliances with all the right people. Forge your own destiny by creating or joining a guild. This system is the cornerstone of the server's social and competitive structure.
*   **Create & Customize**: Found your own guild with a unique name, tag, motto, and description. Just don't get any funny ideas. The Brewmaster sees all. *"Whoa woah woah pal, that right there's got some 'words' we uh, keep off the books. Let's try somethin’ a lil' classier, alright? Alright."*
*   **Recruit & Manage**: Invite members, promote a Vice-Guildmaster, and manage your roster. Can't invite people if you're not in a crew yourself, though. *"Bud, ya can't be sellin' rooms in a house that don't exist. How's 'bout I set you up with a nice guild here, then you can do with the invitations."*
*   **Warfare & Alliances**: Declare war on rival guilds, initiate raids to plunder their treasury, purchase shields for defense, and forge alliances.
*   **Upgrade & Prosper**: Use your guild's funds to upgrade its Tier, unlocking powerful benefits, better defenses, and higher compound interest on your vault. On top of that, you start off with one free guild emoji and guild sticker slot, and you can earn more by upgrading your tier! Go find your place and represent your clan!

### 💰 Economy System
In 'Tony's establishment', Crowns (👑) are king.
*   **Earn Crowns**:
    *   Claim a daily reward with `/econ daily`.
    *   Build a `/bump` streak for the server.
    *   Become an `Active Chatter` by participating in conversations.
    *   Be the first to welcome new members.
    *   Win weekly leaderboard prizes.
*   **Spend Crowns**:
    *   Fund your guild to pay for upgrades and shields.
    *   Pay other users.
    *   Gamble at The Weary Wager.
    *   Purchase vanity roles and other server perks.

### 🎲 The Weary Wager (Gambling)
Feeling lucky? Visit Greg, one of Tony's dealers (card dealer) at The Weary Wager, for a variety of games of chance. Just don't try to pull a fast one. Not because you'd get caught, but because Greg's not paid enough to deal with it and is overworked enough as it.
*   **Blackjack**: Play a classic game of 21 against the house.
*   **Slots**: Try your luck at the slot machine for a chance to win the global jackpot.
*   **Coinflip**: A 50/50 chance to double your bet.
*   **Texas Hold'em Poker**: Go head-to-head against Greg in a 1v1 poker match.
*   **Jackpot**: Many games contribute to a global jackpot that can be won through high-tier play!

### ✨ Character System (In Development)
The next major evolution for Brewmaster is a comprehensive, server-wide D&D character system. Tony's letting members create a unique persona that grows and interacts with all of the bot's other systems.
*   **Six Core Stats**: `Might`, `Finesse`, `Wits`, `Grit`, `Charm`, and `Fortune`.
*   **Character Origins**: Choose a background like `City Guard`, `Tinker`, or `Noble Scion`, each granting a unique starting perk that integrates with server activities.
*   **Archetypes (Classes)**: Level up through one of 12 distinct Archetypes, each with 16 unique abilities unlocked over 100 levels. These classes are designed for deep integration with the guild, economy, and raiding systems. Examples include:
    *   **The Golemancer**: An engineer who builds and commands a powerful clockwork golem.
    *   **The Reaper**: An opportunist who profits from the misfortune of others by siphoning lost Crowns from failed raids.
    *   **The Artisan**: A master crafter who gathers resources and produces tangible items and guild enhancements.
    *   **The Saboteur**: An agent of espionage who weakens enemies from the shadows before a battle begins.
---

## Command List

Here is a list of the primary commands available for Brewmaster. For detailed information on any command group, use `/help` in the server.

| Command | Description |
| :--- | :--- |
| **/help** | Get information about Brewmaster commands and features. |
| **/econ** | Manage your Crowns, claim dailies, pay users, and view leaderboards. |
| **/guild** | The central command for all guild-related actions: create, manage, raid, upgrade, etc. |
| **/gamble** | Play games of chance like Blackjack, Poker, Slots, and Coinflip. |
| **/pin** | Allows Section DMs and Guildmasters to pin important messages in their channels. |

---

## Technical Details

### Technology Stack
*   **Framework**: [Discord.JS](https://discord.js.org/) v14.19.3
*   **Runtime**: [Node.js](https://nodejs.org/) v23.1.0
*   **Database**: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) v11.10.0
*   **Scheduling**: [node-cron](https://www.npmjs.com/package/node-cron) v4.0.5 & [node-schedule](https://www.npmjs.com/package/node-schedule) v2.1.1

### Project Structure
/
├── commands/
│ └── utility/
│ │ ├── econ.js
│ │ ├── gamble.js
│ │ ├── guild.js
│ │ ├── help.js
│ │ └── pin.js
├── events/
│ ├── guildMemberAdd.js
│ ├── interactionCreate.js
│ ├── messageCreate.js
│ └── ready.js
├── tasks/
│ ├── bumpReminder.js
│ ├── dailyReminder.js
│ ├── dailyReset.js
│ └── weeklyReset.js
├── utils/
│ ├── chatFilters.js
│ ├── emoji.js
│ ├── getTierBenefits.js
│ ├── getWeekIdentifier.js
│ ├── handleCrownRewards.js
│ ├── handleMotwGiveaway.js
│ ├── sendMessageToChannel.js
│ └── updateLeaderboard.js
├── bump_data.db
├── database.js
└── index.js
---

## Development Roadmap

Brewmaster is under continuous development. Here are some of the features and ideas planned for the future, sourced from our Trello board and community suggestions.

### High-Priority Projects
*   **Full `/character` System**: Flesh out all 12 Archetypes with full ability progressions.
*   **System Integration**: Deeply connect the Character System with all existing commands (`/econ`, `/guild`, `/gamble`).
*   **PvP Gambling**: Allow members to wager Crowns against each other in games.
*   **Guild Alliances & Enemies**: Formalize relationships between guilds for strategic advantage and conflict.

### Community Suggestions
*   **Loot Crates**: Add chests/loot boxes as potential rewards from daily claims and events.
*   **Expanded Gambling**: Add features like "Splitting" and "Double Down" to Blackjack and an "All-In" button for Poker.
*   **Economy Loans**: Implement a system for members to borrow Crowns.
