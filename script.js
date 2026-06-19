// ═══════════════════════════════════════════════════════════════
//  🃏  ONLINE POKER  —  script.js  (v4.0)
//  Features: Auth/Login, Admin Panel, DMs, Inactivity Kick,
//            Chat Reconnect Fix, Global Chat 1-day TTL, 100-cap
// ═══════════════════════════════════════════════════════════════
console.log('🎮 Poker game script loading...');

try {

    // ═══════════════════════════════════════════════════════════════
    //  SANDBOX-SAFE ALERT / CONFIRM REPLACEMENTS
    //  (native alert/confirm are blocked in Google Sites iframes)
    // ═══════════════════════════════════════════════════════════════
    function showAlert(msg, icon = 'ℹ️') {
        return new Promise(resolve => {
            const overlay = document.getElementById('customAlertOverlay');
            document.getElementById('customAlertIcon').textContent = icon;
            document.getElementById('customAlertMsg').textContent  = msg;
            overlay.classList.remove('hidden');
            const btn = document.getElementById('customAlertOk');
            const done = () => {
                overlay.classList.add('hidden');
                btn.removeEventListener('click', done);
                resolve();
            };
            btn.addEventListener('click', done);
        });
    }

    function showConfirm(msg, icon = '❓') {
        return new Promise(resolve => {
            const overlay = document.getElementById('customConfirmOverlay');
            document.getElementById('customConfirmIcon').textContent = icon;
            document.getElementById('customConfirmMsg').textContent  = msg;
            overlay.classList.remove('hidden');
            const yes = document.getElementById('customConfirmYes');
            const no  = document.getElementById('customConfirmNo');
            const cleanup = (result) => {
                overlay.classList.add('hidden');
                yes.removeEventListener('click', onYes);
                no.removeEventListener('click',  onNo);
                // Close on overlay click
                overlay.removeEventListener('click', onOverlay);
                resolve(result);
            };
            const onYes     = () => cleanup(true);
            const onNo      = () => cleanup(false);
            const onOverlay = (e) => { if (e.target === overlay) cleanup(false); };
            yes.addEventListener('click', onYes);
            no.addEventListener('click',  onNo);
            overlay.addEventListener('click', onOverlay);
        });
    }

    // ── Firebase Config ──────────────────────────────────────────
    const firebaseConfig = {
        apiKey: "AIzaSyCFiY4DBM-7RBI_5e2SaTTLnWlSxFKqPfs",
        authDomain: "poker-68ab2.firebaseapp.com",
        databaseURL: "https://poker-68ab2-default-rtdb.firebaseio.com",
        projectId: "poker-68ab2",
        storageBucket: "poker-68ab2.firebasestorage.app",
        messagingSenderId: "902045724137",
        appId: "1:902045724137:web:7929f45ed8799dd82cef78",
        measurementId: "G-ERB93RX8T0"
    };

    if (typeof firebase === 'undefined') throw new Error('Firebase SDK not loaded!');
    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();
    console.log('✓ Firebase initialized');

    // ── Constants ────────────────────────────────────────────────
    const SMALL_BLIND    = 10;
    const BIG_BLIND      = 20;
    const GAME_VERSION   = 'v4.5';
    const INACTIVITY_MS  = 60 * 60 * 1000;   // 1 hour
    const REJOIN_WINDOW  = 5 * 60 * 1000;    // 5 minutes
    const GLOBAL_CHAT_TTL = 24 * 60 * 60 * 1000; // 1 day
    const suits  = ['♠','♥','♦','♣'];
    const ranks  = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

    // ── Session State ────────────────────────────────────────────
    let currentUser   = null;  // { username, uid }
    let gameId        = null;
    let playerId      = null;
    let playerName    = null;
    let gameState     = null;
    let cleanupInterval   = null;
    let heartbeatInterval = null;
    let inactivityTimer   = null;
    let lastActivityTime  = Date.now();
    let activeChatTab     = 'room';
    let turnTimerInterval = null;   // local countdown interval (my turn bar)
    let turnTimerDisplay  = null;   // countdown bar element ref
    let lastTurnTimestamp  = 0;     // tracks last turn timestamp MY timer started for
    let lastPlayerTimerTs  = 0;     // tracks last turn timestamp the OTHER-player tick started for
    let playerTimerInterval = null; // interval for refreshing other-player countdown labels
    let autoActInProgress = false;  // guard: prevent concurrent autoActOnTimeout calls
    let actionSubmitting  = false;  // true while Firebase write is in-flight: hides action panel to prevent flicker
    const TURN_SECONDS    = 15;     // seconds per turn
    let roomVisibility    = 'public';
    let selectedGameType  = 'poker'; // 'poker' or 'blackjack'
    let selectedRoomType  = 'poker'; // room browser filter: 'poker' or 'blackjack'
    let activeDmConvoId   = null;  // currently open DM thread
    let dmListeners       = {};    // key: convoId, value: firebase listener
    let globalChatRef     = null;  // kept for reconnect management
    let _lastGlobalChatTs  = 0;    // newest ts seen in either context
    let _shownGlobalKeys   = new Set(); // keys already rendered in the IN-GAME global tab
    let _shownGcwKeys      = new Set(); // keys already rendered in the LOBBY widget (separate)
    let gcwListenerActive = false;
    let isGameAdmin       = false; // true if user has global game-admin powers
    let isSittingOutPending = false;  // player requested sit-out — takes effect after hand
    let _autoStartPending  = false;  // guard: prevents double-scheduling startGame from listenToGame
    let _prevPendingAdmitSet = new Set(); // tracks which pendingAdmit player IDs we've already notified about
    let bumUsernames = new Set();   // usernames in the Firebase `bum/` branch — shown with 🚮 bum rank badge
    let _admitNotifTimeout = null;        // timer for auto-dismissing the notification banner
    let activeLbTab        = 'streak'; // leaderboard tab
    let onboardingStep     = 0;       // current onboarding page

    // ── Emoji shortcuts ──────────────────────────────────────────
    const EMOJI_MAP = {
        ":grinning:": "😀", ":smiley:": "😃", ":smile:": "😄", ":grin:": "😁",
        ":laughing:": "😆", ":sweat_smile:": "😅", ":rofl:": "🤣", ":joy:": "😂",
        ":slightly_smiling_face:": "🙂", ":upside_down_face:": "🙃", ":melting_face:": "🫠", ":wink:": "😉",
        ":blush:": "😊", ":innocent:": "😇", ":heart_eyes:": "😍", ":kissing_heart:": "😘",
        ":kissing:": "😗", ":kissing_smiling_eyes:": "😙", ":kissing_closed_eyes:": "😚", ":yum:": "😋",
        ":stuck_out_tongue:": "😛", ":stuck_out_tongue_winking_eye:": "😜", ":zany_face:": "🤪", ":stuck_out_tongue_closed_eyes:": "😝",
        ":money_mouth_face:": "🤑", ":hugs:": "🤗", ":hand_over_mouth:": "🫢", ":shushing_face:": "🤫",
        ":thinking:": "🤔", ":saluting_face:": "🫡", ":zipper_mouth_face:": "🤐", ":raised_eyebrow:": "🤨",
        ":neutral_face:": "😐", ":expressionless:": "😑", ":no_mouth:": "😶", ":smirk:": "😏",
        ":unamused:": "😒", ":roll_eyes:": "🙄", ":grimacing:": "😬", ":lying_face:": "🤥",
        ":relieved:": "😌", ":pensive:": "😔", ":sleepy:": "😪", ":drooling_face:": "🤤",
        ":sleeping:": "😴", ":mask:": "😷", ":face_with_thermometer:": "🤒", ":face_with_head_bandage:": "🤕",
        ":nauseated_face:": "🤢", ":sneezing_face:": "🤧", ":hot_face:": "🥵", ":cold_face:": "🥶",
        ":woozy_face:": "🥴", ":dizzy_face:": "😵", ":exploding_head:": "🤯", ":cowboy_hat_face:": "🤠",
        ":partying_face:": "🥳", ":disguised_face:": "🥸", ":sunglasses:": "😎", ":nerd_face:": "🤓",
        ":monocle_face:": "🧐", ":confused:": "😕", ":worried:": "😟", ":slightly_frowning_face:": "🙁",
        ":frowning_face:": "☹️", ":open_mouth:": "😮", ":hushed:": "😯", ":astonished:": "😲",
        ":flushed:": "😳", ":pleading_face:": "🥺", ":face_holding_back_tears:": "🥹", ":anguished:": "😧",
        ":fearful:": "😨", ":cold_sweat:": "😰", ":disappointed_relieved:": "😥", ":cry:": "😢",
        ":sob:": "😭", ":scream:": "😱", ":confounded:": "😖", ":persevere:": "😣",
        ":disappointed:": "😞", ":sweat:": "😓", ":weary:": "😩", ":tired_face:": "😫",
        ":yawning_face:": "🥱", ":triumph:": "😤", ":rage:": "😡", ":angry:": "😠",
        ":skull_crossbones:": "☠️", ":skull:": "💀", ":poop:": "💩", ":clown_face:": "🤡",
        ":japanese_ogre:": "👹", ":japanese_goblin:": "👺", ":ghost:": "👻", ":alien:": "👽",
        ":space_invader:": "👾", ":robot:": "🤖", ":smiley_cat:": "😺", ":smile_cat:": "😸",
        ":joy_cat:": "😹", ":heart_eyes_cat:": "😻", ":smirk_cat:": "😼", ":kissing_cat:": "😽",
        ":scream_cat:": "🙀", ":crying_cat_face:": "😿", ":pouting_cat:": "😾", ":see_no_evil:": "🙈",
        ":hear_no_evil:": "🙉", ":speak_no_evil:": "🙊", ":kiss:": "💋", ":love_letter:": "💌",
        ":cupid:": "💘", ":gift_heart:": "💝", ":sparkling_heart:": "💖", ":heartpulse:": "💗",
        ":heartbeat:": "💓", ":revolving_hearts:": "💞", ":two_hearts:": "💕", ":heart_decoration:": "💟",
        ":heavy_heart_exclamation:": "❣️", ":broken_heart:": "💔", ":heart:": "❤️", ":orange_heart:": "🧡",
        ":yellow_heart:": "💛", ":green_heart:": "💚", ":blue_heart:": "💙", ":purple_heart:": "💜",
        ":brown_heart:": "🤎", ":black_heart:": "🖤", ":white_heart:": "🤍", ":pink_heart:": "🩷",
        ":light_blue_heart:": "🩵", ":grey_heart:": "🩶", ":wave:": "👋", ":raised_back_of_hand:": "🤚",
        ":hand:": "✋", ":vulcan_salute:": "🖖", ":ok_hand:": "👌", ":pinched_fingers:": "🤌",
        ":pinching_hand:": "🤏", ":v:": "✌️", ":crossed_fingers:": "🤞", ":hand_with_index_finger_and_thumb_crossed:": "🫰",
        ":metal:": "🤘", ":call_me_hand:": "🤙", ":point_left:": "👈", ":point_right:": "👉",
        ":point_up_2:": "👆", ":middle_finger:": "🖕", ":point_down:": "👇", ":point_up:": "☝️",
        ":index_pointing_at_the_viewer:": "🫵", ":thumbsup:": "👍", ":thumbsdown:": "👎", ":fist:": "✊",
        ":facepunch:": "👊", ":clap:": "👏", ":raised_hands:": "🙌", ":heart_hands:": "🫶",
        ":open_hands:": "👐", ":pray:": "🙏", ":handshake:": "🤝", ":nail_care:": "💅",
        ":ear:": "👂", ":nose:": "👃", ":eyes:": "👀", ":eye:": "👁️",
        ":tongue:": "👅", ":lips:": "👄", ":biting_lip:": "🫦", ":brain:": "🧠",
        ":muscle:": "💪", ":leg:": "🦵", ":foot:": "🦶", ":tooth:": "🦷",
        ":bone:": "🦴", ":baby:": "👶", ":child:": "🧒", ":boy:": "👦",
        ":girl:": "👧", ":adult:": "🧑", ":man:": "👨", ":woman:": "👩",
        ":old_man:": "👴", ":old_woman:": "👵", ":older_adult:": "🧓", ":person_frowning:": "🙍",
        ":person_pouting:": "🙎", ":no_good:": "🙅", ":ok_woman:": "🙆", ":information_desk_person:": "💁",
        ":raising_hand:": "🙋", ":deaf_person:": "🧏", ":bow:": "🙇", ":facepalm:": "🤦",
        ":shrug:": "🤷", ":doctor:": "🧑‍⚕️", ":student:": "🧑‍🎓", ":teacher:": "🧑‍🏫",
        ":farmer:": "🧑‍🌾", ":cook:": "🧑‍🍳", ":mechanic:": "🧑‍🔧", ":office_worker:": "🧑‍💼",
        ":scientist:": "🧑‍🔬", ":technologist:": "🧑‍💻", ":artist:": "🧑‍🎨", ":pilot:": "🧑‍✈️",
        ":astronaut:": "🧑‍🚀", ":firefighter:": "🧑‍🚒", ":police_officer:": "👮", ":detective:": "🕵️",
        ":guard:": "💂", ":ninja:": "🥷", ":construction_worker:": "👷", ":prince:": "🤴",
        ":princess:": "👸", ":person_wearing_turban:": "👳", ":santa:": "🎅", ":mrs_claus:": "🤶",
        ":superhero:": "🦸", ":supervillain:": "🦹", ":mage:": "🧙", ":fairy:": "🧚",
        ":vampire:": "🧛", ":merperson:": "🧜", ":elf:": "🧝", ":genie:": "🧞",
        ":zombie:": "🧟", ":troll:": "🧌", ":angel:": "😇", ":pregnant_woman:": "🤰",
        ":breast_feeding:": "🤱", ":people_hugging:": "🫂", ":family:": "👪", ":couple:": "👫",
        ":two_men_holding_hands:": "👬", ":two_women_holding_hands:": "👭", ":couplekiss:": "💏", ":couple_with_heart:": "💑",
        ":shirt:": "👕", ":jeans:": "👖", ":scarf:": "🧣", ":gloves:": "🧤",
        ":coat:": "🧥", ":socks:": "🧦", ":dress:": "👗", ":kimono:": "👘",
        ":sari:": "🥻", ":bikini:": "👙", ":womans_clothes:": "👚", ":purse:": "👛",
        ":handbag:": "👜", ":pouch:": "👝", ":shopping:": "🛍️", ":school_satchel:": "🎒",
        ":mans_shoe:": "👞", ":athletic_shoe:": "👟", ":hiking_boot:": "🥾", ":flat_shoe:": "🥿",
        ":high_heel:": "👠", ":sandal:": "👡", ":ballet_shoes:": "🩰", ":boot:": "👢",
        ":tophat:": "🎩", ":hat:": "🎩", ":womans_hat:": "👒", ":billed_cap:": "🧢",
        ":military_helmet:": "🪖", ":crown:": "👑", ":ring:": "💍", ":gem:": "💎",
        ":dog:": "🐶", ":cat:": "🐱", ":mouse:": "🐭", ":hamster:": "🐹",
        ":rabbit:": "🐰", ":fox_face:": "🦊", ":bear:": "🐻", ":panda_face:": "🐼",
        ":polar_bear:": "🐻‍❄️", ":koala:": "🐨", ":tiger:": "🐯", ":lion:": "🦁",
        ":cow:": "🐮", ":pig:": "🐷", ":pig_nose:": "🐽", ":frog:": "🐸",
        ":monkey_face:": "🐵", ":chicken:": "🐔", ":penguin:": "🐧", ":bird:": "🐦",
        ":baby_chick:": "🐤", ":hatching_chick:": "🐣", ":hatched_chick:": "🐥", ":duck:": "🦆",
        ":eagle:": "🦅", ":owl:": "🦉", ":flamingo:": "🦩", ":peacock:": "🦚",
        ":parrot:": "🦜", ":crocodile:": "🐊", ":turtle:": "🐢", ":lizard:": "🦎",
        ":snake:": "🐍", ":dragon_face:": "🐲", ":dragon:": "🐉", ":sauropod:": "🦕",
        ":t_rex:": "🦖", ":whale:": "🐳", ":whale2:": "🐋", ":dolphin:": "🐬",
        ":seal:": "🦭", ":fish:": "🐟", ":tropical_fish:": "🐠", ":blowfish:": "🐡",
        ":shark:": "🦈", ":octopus:": "🐙", ":shell:": "🐚", ":snail:": "🐌",
        ":butterfly:": "🦋", ":bug:": "🐛", ":ant:": "🐜", ":bee:": "🐝",
        ":lady_beetle:": "🐞", ":cricket:": "🦗", ":cockroach:": "🪳", ":spider:": "🕷️",
        ":spider_web:": "🕸️", ":scorpion:": "🦂", ":mosquito:": "🦟", ":fly:": "🪰",
        ":worm:": "🪱", ":microbe:": "🦠", ":bouquet:": "💐", ":cherry_blossom:": "🌸",
        ":white_flower:": "💮", ":lotus:": "🪷", ":rose:": "🌹", ":wilted_flower:": "🥀", ":wilted_rose:": "🥀",
        ":hibiscus:": "🌺", ":sunflower:": "🌻", ":blossom:": "🌼", ":tulip:": "🌷",
        ":seedling:": "🌱", ":potted_plant:": "🪴", ":evergreen_tree:": "🌲", ":deciduous_tree:": "🌳",
        ":palm_tree:": "🌴", ":cactus:": "🌵", ":ear_of_rice:": "🌾", ":herb:": "🌿",
        ":shamrock:": "☘️", ":four_leaf_clover:": "🍀", ":maple_leaf:": "🍁", ":fallen_leaf:": "🍂",
        ":leaves:": "🍃", ":mushroom:": "🍄", ":chestnut:": "🌰", ":grapes:": "🍇",
        ":melon:": "🍈", ":watermelon:": "🍉", ":tangerine:": "🍊", ":lemon:": "🍋",
        ":banana:": "🍌", ":pineapple:": "🍍", ":mango:": "🥭", ":apple:": "🍎",
        ":green_apple:": "🍏", ":pear:": "🍐", ":peach:": "🍑", ":cherries:": "🍒",
        ":strawberry:": "🍓", ":blueberries:": "🫐", ":kiwi_fruit:": "🥝", ":tomato:": "🍅",
        ":olive:": "🫒", ":coconut:": "🥥", ":avocado:": "🥑", ":eggplant:": "🍆",
        ":potato:": "🥔", ":carrot:": "🥕", ":corn:": "🌽", ":hot_pepper:": "🌶️",
        ":bell_pepper:": "🫑", ":cucumber:": "🥒", ":leafy_green:": "🥬", ":broccoli:": "🥦",
        ":garlic:": "🧄", ":onion:": "🧅", ":peanuts:": "🥜", ":beans:": "🫘",
        ":bread:": "🍞", ":croissant:": "🥐", ":baguette_bread:": "🥖", ":flatbread:": "🫓",
        ":pretzel:": "🥨", ":bagel:": "🥯", ":pancakes:": "🥞", ":waffle:": "🧇",
        ":cheese:": "🧀", ":meat_on_bone:": "🍖", ":poultry_leg:": "🍗", ":cut_of_meat:": "🥩",
        ":bacon:": "🥓", ":hamburger:": "🍔", ":fries:": "🍟", ":pizza:": "🍕",
        ":hotdog:": "🌭", ":sandwich:": "🥪", ":taco:": "🌮", ":burrito:": "🌯",
        ":tamale:": "🫔", ":stuffed_flatbread:": "🥙", ":falafel:": "🧆", ":egg:": "🥚",
        ":cooking:": "🍳", ":shallow_pan_of_food:": "🥘", ":stew:": "🍲", ":bowl_with_spoon:": "🥣",
        ":green_salad:": "🥗", ":popcorn:": "🍿", ":butter:": "🧈", ":salt:": "🧂",
        ":canned_food:": "🥫", ":bento:": "🍱", ":rice_cracker:": "🍘", ":rice_ball:": "🍙",
        ":rice:": "🍚", ":curry:": "🍛", ":ramen:": "🍜", ":spaghetti:": "🍝",
        ":sweet_potato:": "🍠", ":oden:": "🍢", ":sushi:": "🍣", ":fried_shrimp:": "🍤",
        ":fish_cake:": "🍥", ":moon_cake:": "🥮", ":dango:": "🍡", ":dumpling:": "🥟",
        ":fortune_cookie:": "🥠", ":takeout_box:": "🥡", ":crab:": "🦀", ":lobster:": "🦞",
        ":shrimp:": "🦐", ":squid:": "🦑", ":oyster:": "🦪", ":icecream:": "🍦",
        ":shaved_ice:": "🍧", ":ice_cream:": "🍨", ":doughnut:": "🍩", ":cookie:": "🍪",
        ":birthday:": "🎂", ":cake:": "🍰", ":cupcake:": "🧁", ":pie:": "🥧",
        ":chocolate_bar:": "🍫", ":candy:": "🍬", ":lollipop:": "🍭", ":custard:": "🍮",
        ":honey_pot:": "🍯", ":baby_bottle:": "🍼", ":milk_glass:": "🥛", ":coffee:": "☕",
        ":teapot:": "🫖", ":tea:": "🍵", ":sake:": "🍶", ":champagne:": "🍾",
        ":wine_glass:": "🍷", ":cocktail:": "🍸", ":tropical_drink:": "🍹", ":beer:": "🍺",
        ":beers:": "🍻", ":clinking_glasses:": "🥂", ":tumbler_glass:": "🥃", ":cup_with_straw:": "🥤",
        ":bubble_tea:": "🧋", ":mate:": "🧉", ":ice_cube:": "🧊", ":chopsticks:": "🥢",
        ":fork_and_knife:": "🍴", ":spoon:": "🥄", ":rocket:": "🚀", ":flying_saucer:": "🛸",
        ":airplane:": "✈️", ":helicopter:": "🚁", ":parachute:": "🪂", ":seat:": "💺",
        ":car:": "🚗", ":taxi:": "🚕", ":bus:": "🚌", ":trolleybus:": "🚎",
        ":racing_car:": "🏎️", ":police_car:": "🚓", ":ambulance:": "🚑", ":fire_engine:": "🚒",
        ":minibus:": "🚐", ":truck:": "🚚", ":articulated_lorry:": "🚛", ":tractor:": "🚜",
        ":kick_scooter:": "🛴", ":bike:": "🚲", ":motor_scooter:": "🛵", ":motorcycle:": "🏍️",
        ":train:": "🚋", ":train2:": "🚆", ":bullettrain_side:": "🚄", ":bullettrain_front:": "🚅",
        ":steam_locomotive:": "🚂", ":ship:": "🚢", ":speedboat:": "🚤", ":sailboat:": "⛵",
        ":canoe:": "🛶", ":anchor:": "⚓", ":fuelpump:": "⛽", ":construction:": "🚧",
        ":rotating_light:": "🚨", ":traffic_light:": "🚥", ":vertical_traffic_light:": "🚦", ":earth_africa:": "🌍",
        ":earth_americas:": "🌎", ":earth_asia:": "🌏", ":world_map:": "🗺️", ":japan:": "🗾",
        ":compass:": "🧭", ":mountain_snow:": "🏔️", ":mountain:": "⛰️", ":volcano:": "🌋",
        ":mount_fuji:": "🗻", ":camping:": "🏕️", ":beach_umbrella:": "🏖️", ":desert:": "🏜️",
        ":desert_island:": "🏝️", ":stadium:": "🏟️", ":classical_building:": "🏛️", ":building_construction:": "🏗️",
        ":bricks:": "🧱", ":rock:": "🪨", ":wood:": "🪵", ":hut:": "🛖",
        ":house:": "🏠", ":house_with_garden:": "🏡", ":office:": "🏢", ":hospital:": "🏥",
        ":bank:": "🏦", ":hotel:": "🏨", ":convenience_store:": "🏪", ":school:": "🏫",
        ":love_hotel:": "🏩", ":wedding:": "💒", ":european_castle:": "🏰", ":japanese_castle:": "🏯",
        ":sunrise_over_mountains:": "🌄", ":sunrise:": "🌅", ":city_sunrise:": "🌇", ":city_sunset:": "🌆",
        ":cityscape:": "🏙️", ":night_with_stars:": "🌃", ":milky_way:": "🌌", ":bridge_at_night:": "🌉",
        ":soccer:": "⚽", ":basketball:": "🏀", ":football:": "🏈", ":baseball:": "⚾",
        ":softball:": "🥎", ":tennis:": "🎾", ":flying_disc:": "🥏", ":volleyball:": "🏐",
        ":rugby_football:": "🏉", ":8ball:": "🎱", ":ping_pong:": "🏓", ":badminton:": "🏸",
        ":ice_hockey:": "🏒", ":field_hockey:": "🏑", ":cricket_game:": "🏏", ":boomerang:": "🪃",
        ":bow_and_arrow:": "🏹", ":fishing_pole_and_fish:": "🎣", ":diving_mask:": "🤿", ":boxing_glove:": "🥊",
        ":martial_arts_uniform:": "🥋", ":sled:": "🛷", ":curling_stone:": "🥌", ":ice_skate:": "⛸️",
        ":ski:": "🎿", ":skateboard:": "🛹", ":trophy:": "🏆", ":medal_sports:": "🏅",
        ":medal_military:": "🎖️", ":1st_place_medal:": "🥇", ":2nd_place_medal:": "🥈", ":3rd_place_medal:": "🥉",
        ":ticket:": "🎫", ":tickets:": "🎟️", ":circus_tent:": "🎪", ":performing_arts:": "🎭",
        ":art:": "🎨", ":slot_machine:": "🎰", ":game_die:": "🎲", ":dice:": "🎲",
        ":jigsaw:": "🧩", ":teddy_bear:": "🧸", ":spades:": "♠️", ":hearts:": "♥️",
        ":diamonds:": "♦️", ":clubs:": "♣️", ":chess_pawn:": "♟️", ":joker:": "🃏",
        ":video_game:": "🎮", ":dart:": "🎯", ":kite:": "🪁", ":mute:": "🔇",
        ":sound:": "🔉", ":loud_sound:": "🔊", ":loudspeaker:": "📢", ":mega:": "📣",
        ":bell:": "🔔", ":no_bell:": "🔕", ":musical_note:": "🎵", ":notes:": "🎶",
        ":microphone:": "🎤", ":headphones:": "🎧", ":radio:": "📻", ":saxophone:": "🎷",
        ":accordion:": "🪗", ":guitar:": "🎸", ":musical_keyboard:": "🎹", ":trumpet:": "🎺",
        ":violin:": "🎻", ":banjo:": "🪕", ":drum:": "🥁", ":long_drum:": "🪘",
        ":iphone:": "📱", ":calling:": "📲", ":phone:": "☎️", ":telephone_receiver:": "📞",
        ":pager:": "📟", ":fax:": "📠", ":battery:": "🔋", ":electric_plug:": "🔌",
        ":computer:": "💻", ":desktop_computer:": "🖥️", ":printer:": "🖨️", ":keyboard:": "⌨️",
        ":computer_mouse:": "🖱️", ":minidisc:": "💽", ":floppy_disk:": "💾", ":cd:": "💿",
        ":dvd:": "📀", ":abacus:": "🧮", ":movie_camera:": "🎥", ":film_strip:": "🎞️",
        ":clapper:": "🎬", ":tv:": "📺", ":camera:": "📷", ":camera_flash:": "📸",
        ":video_camera:": "📹", ":mag:": "🔍", ":mag_right:": "🔎", ":candle:": "🕯️",
        ":bulb:": "💡", ":flashlight:": "🔦", ":lantern:": "🏮", ":diya_lamp:": "🪔",
        ":book:": "📖", ":books:": "📚", ":notebook:": "📓", ":scroll:": "📜",
        ":page_facing_up:": "📄", ":newspaper:": "📰", ":bookmark:": "🔖", ":label:": "🏷️",
        ":money_with_wings:": "💸", ":dollar:": "💵", ":yen:": "💴", ":euro:": "💶",
        ":pound:": "💷", ":coin:": "🪙", ":moneybag:": "💰", ":credit_card:": "💳",
        ":receipt:": "🧾", ":chart_with_upwards_trend:": "📈", ":chart_with_downwards_trend:": "📉", ":bar_chart:": "📊",
        ":clipboard:": "📋", ":calendar:": "📅", ":card_index:": "📇", ":file_folder:": "📁",
        ":open_file_folder:": "📂", ":inbox_tray:": "📥", ":outbox_tray:": "📤", ":package:": "📦",
        ":e_mail:": "📧", ":mailbox:": "📫", ":postbox:": "📮", ":memo:": "📝",
        ":pencil2:": "✏️", ":black_nib:": "✒️", ":fountain_pen:": "🖊️", ":paintbrush:": "🖌️",
        ":crayon:": "🖍️", ":briefcase:": "💼", ":scissors:": "✂️", ":paperclip:": "📎",
        ":straight_ruler:": "📏", ":triangular_ruler:": "📐", ":lock:": "🔒", ":unlock:": "🔓",
        ":key:": "🔑", ":old_key:": "🗝️", ":hammer:": "🔨", ":axe:": "🪓",
        ":pick:": "⛏️", ":hammer_and_wrench:": "🛠️", ":dagger:": "🗡️", ":sword:": "⚔️",
        ":shield:": "🛡️", ":carpentry_saw:": "🪚", ":wrench:": "🔧", ":screwdriver:": "🪛",
        ":nut_and_bolt:": "🔩", ":gear:": "⚙️", ":link:": "🔗", ":chains:": "⛓️",
        ":hook:": "🪝", ":toolbox:": "🧰", ":magnet:": "🧲", ":ladder:": "🪜",
        ":alembic:": "⚗️", ":test_tube:": "🧪", ":petri_dish:": "🧫", ":dna:": "🧬",
        ":microscope:": "🔬", ":telescope:": "🔭", ":satellite2:": "📡", ":syringe:": "💉",
        ":drop_of_blood:": "🩸", ":pill:": "💊", ":adhesive_bandage:": "🩹", ":stethoscope:": "🩺",
        ":door:": "🚪", ":bed:": "🛏️", ":couch_and_lamp:": "🛋️", ":chair:": "🪑",
        ":toilet:": "🚽", ":shower:": "🚿", ":bathtub:": "🛁", ":razor:": "🪒",
        ":lotion_bottle:": "🧴", ":safety_pin:": "🧷", ":broom:": "🧹", ":basket:": "🧺",
        ":roll_of_paper:": "🧻", ":bucket:": "🪣", ":soap:": "🧼", ":toothbrush:": "🪥",
        ":sponge:": "🧽", ":fire_extinguisher:": "🧯", ":shopping_cart:": "🛒", ":smoking:": "🚬",
        ":coffin:": "⚰️", ":funeral_urn:": "⚱️", ":crystal_ball:": "🔮", ":nazar_amulet:": "🧿",
        ":dolls:": "🎎", ":ribbon:": "🎀", ":gift:": "🎁", ":balloon:": "🎈",
        ":tada:": "🎉", ":confetti_ball:": "🎊", ":christmas_tree:": "🎄", ":sparkler:": "🎇",
        ":fireworks:": "🎆", ":firecracker:": "🧨", ":100:": "💯", ":fire:": "🔥",
        ":sos:": "🆘", ":no_entry_sign:": "🚫", ":warning:": "⚠️", ":zap:": "⚡",
        ":white_check_mark:": "✅", ":heavy_check_mark:": "✔️", ":heavy_plus_sign:": "➕", ":heavy_minus_sign:": "➖",
        ":heavy_division_sign:": "➗", ":heavy_multiplication_x:": "✖️", ":infinity:": "♾️", ":bangbang:": "‼️",
        ":interrobang:": "⁉️", ":question:": "❓", ":grey_question:": "❔", ":grey_exclamation:": "❕",
        ":exclamation:": "❗", ":recycle:": "♻️", ":trident:": "🔱", ":beginner:": "🔰",
        ":x:": "❌", ":o:": "⭕", ":stop_sign:": "🛑", ":large_blue_circle:": "🔵",
        ":large_orange_circle:": "🟠", ":large_red_circle:": "🔴", ":large_yellow_circle:": "🟡", ":large_green_circle:": "🟢",
        ":large_purple_circle:": "🟣", ":large_brown_circle:": "🟤", ":black_circle:": "⚫", ":white_circle:": "⚪",
        ":red_square:": "🟥", ":orange_square:": "🟧", ":yellow_square:": "🟨", ":green_square:": "🟩",
        ":blue_square:": "🟦", ":purple_square:": "🟪", ":brown_square:": "🟫", ":black_large_square:": "⬛",
        ":white_large_square:": "⬜", ":sunny:": "☀️", ":full_moon:": "🌕", ":crescent_moon:": "🌙",
        ":new_moon:": "🌑", ":star:": "⭐", ":star2:": "🌟", ":dizzy:": "💫",
        ":sparkle:": "❇️", ":comet:": "☄️", ":partly_sunny:": "⛅", ":rainbow:": "🌈",
        ":cloud:": "☁️", ":cloud_with_rain:": "🌧️", ":cloud_with_snow:": "🌨️", ":cloud_with_lightning:": "🌩️",
        ":tornado:": "🌪️", ":fog:": "🌫️", ":wind_face:": "🌬️", ":cyclone:": "🌀",
        ":snowflake:": "❄️", ":snowman:": "⛄", ":snowman_with_snow:": "☃️", ":water_wave:": "🌊",
        ":droplet:": "💧", ":sweat_drops:": "💦", ":umbrella:": "☂️", ":umbrella_with_rain_drops:": "☔",
        ":arrow_up:": "⬆️", ":arrow_down:": "⬇️", ":arrow_left:": "⬅️", ":arrow_right:": "➡️",
        ":arrows_counterclockwise:": "🔄", ":repeat:": "🔁", ":repeat_one:": "🔂", ":arrow_forward:": "▶️",
        ":fast_forward:": "⏩", ":rewind:": "⏪", ":arrow_up_small:": "🔼", ":arrow_down_small:": "🔽",
        ":pause_button:": "⏸️", ":stop_button:": "⏹️", ":record_button:": "⏺️", ":information_source:": "ℹ️",
        ":new:": "🆕", ":free:": "🆓", ":up:": "🆙", ":cool:": "🆒",
        ":ok:": "🆗", ":end:": "🔚", ":back:": "🔙", ":on:": "🔛",
        ":top:": "🔝", ":soon:": "🔜", ":zero:": "0️⃣", ":one:": "1️⃣",
        ":two:": "2️⃣", ":three:": "3️⃣", ":four:": "4️⃣", ":five:": "5️⃣",
        ":six:": "6️⃣", ":seven:": "7️⃣", ":eight:": "8️⃣", ":nine:": "9️⃣",
        ":ten:": "🔟", ":hash:": "#️⃣", ":asterisk:": "*️⃣", ":checkered_flag:": "🏁",
        ":triangular_flag_on_post:": "🚩", ":crossed_flags:": "🎌", ":black_flag:": "🏴", ":white_flag:": "🏳️",
        ":rainbow_flag:": "🏳️‍🌈", ":pirate_flag:": "🏴‍☠️", ":cards:": "🃏", ":chip:": "🪙",
        ":chips:": "🪙", ":gg:": "🤝", ":winner:": "🥇", ":loser:": "💸",
        ":flush:": "🃏", ":poker:": "🃏", ":ace:": "🃏", ":sparkles:": "✨",
        ":boom:": "💥", ":party:": "🎉", ":gun:": "🔫", ":dumpster:": "🗑️",
        ":music:": "🎵", ":crying_cat:": "😿", ":devil:": "😈"
    };
    function applyEmojiShortcuts(text) {
        text = text.replace(/:[a-z0-9_]+:/g, m => EMOJI_MAP[m] || m);
        text = text.replace(/:[a-z0-9_]+$/g, m => EMOJI_MAP[m + ':'] || m);
        return text;
    }

    // ── Helpers ──────────────────────────────────────────────────
    function escapeHtml(t) {
        const d = document.createElement('div');
        d.textContent = t;
        return d.innerHTML;
    }

    // ── Username truncation helpers ──────────────────────────────
    function truncateName(name, maxLen) {
        if (!name) return '';
        return name.length > maxLen ? name.substring(0, maxLen) + '…' : name;
    }

    // ═══════════════════════════════════════════════════════════════
    //  RUNESCAPE-STYLE PROFANITY FILTER
    //  • Filter is ON by default (stored in localStorage).
    //  • Each player opts in/out independently — their preference only
    //    affects what THEY see on their own screen.
    //  • Messages are ALWAYS sent to Firebase uncensored; censoring is
    //    purely client-side on render (just like RuneScape).
    //  • The "Filter: ON/OFF" button in the chat tab bar toggles it.
    // ═══════════════════════════════════════════════════════════════

    // Default ON — only false if player explicitly turned it off
    let chatFilterEnabled = localStorage.getItem('chatFilterEnabled') !== 'false';

    function updateChatFilterBtn() {
        // Game-screen tab bar button — just the emoji, state shown via CSS class + tooltip
        const btn = document.getElementById('chatFilterBtn');
        if (btn) {
            btn.textContent = '🔤';
            btn.className   = chatFilterEnabled ? 'chat-filter-btn filter-on' : 'chat-filter-btn filter-off';
            btn.title       = chatFilterEnabled ? 'Profanity filter ON — click to turn off' : 'Profanity filter OFF — click to turn on';
        }
        // Global chat widget button — same emoji, same tooltip
        const gcwBtn = document.getElementById('gcwFilterBtn');
        if (gcwBtn) {
            gcwBtn.title   = chatFilterEnabled ? 'Profanity filter ON — click to turn off' : 'Profanity filter OFF — click to turn on';
            gcwBtn.style.opacity = chatFilterEnabled ? '0.85' : '0.4';
        }
    }

    function toggleChatFilter() {
        chatFilterEnabled = !chatFilterEnabled;
        localStorage.setItem('chatFilterEnabled', chatFilterEnabled);
        updateChatFilterBtn();
        // Re-render both chat containers so existing messages update immediately
        rerenderChatWithFilter();
        showToast(chatFilterEnabled ? '🔤 Profanity filter: ON' : '🔤 Profanity filter: OFF');
    }

    // Re-render cached messages when the player toggles the filter mid-session.
    // We store the original (uncensored) text on each message element as a data-raw attribute.
    function rerenderChatWithFilter() {
        // Game-screen chat panels (Room chat + Global tab)
        ['chatContainer','globalChatContainer'].forEach(cid => {
            const container = document.getElementById(cid);
            if (!container) return;
            container.querySelectorAll('.chat-message .message-text[data-raw]').forEach(el => {
                const raw = el.getAttribute('data-raw');
                el.innerHTML = chatFilterEnabled ? censorForDisplay(raw) : escapeHtml(raw);
            });
        });
        // Global chat widget (lobby) — uses .gcw-text[data-raw]
        const gcwMessages = document.getElementById('gcwMessages');
        if (gcwMessages) {
            gcwMessages.querySelectorAll('.gcw-text[data-raw]').forEach(el => {
                const raw = el.getAttribute('data-raw');
                el.innerHTML = chatFilterEnabled ? censorForDisplay(raw) : escapeHtml(raw);
            });
        }
        // DM / group chat panel — uses .dm-msg-bubble[data-raw]
        const dmMessages = document.getElementById('dmMessages');
        if (dmMessages) {
            dmMessages.querySelectorAll('.dm-msg-bubble[data-raw]').forEach(el => {
                const raw = el.getAttribute('data-raw');
                el.innerHTML = chatFilterEnabled ? censorForDisplay(raw) : escapeHtml(raw);
            });
        }
    }

    const BANNED_WORDS = [
        'fuck','shit','bitch','ass','asshole','cunt','dick','cock','pussy',
        'nigger','nigga','faggot','fag','retard','whore','slut','bastard',
        'motherfucker','fucker','piss','crap','damn','hell','wtf','stfu',
        'kys','kms'
    ];
    // Build a regex that catches obfuscation (f*ck, f_u_c_k) and embedded words
    const PROFANITY_RE = new RegExp(
        '(' + BANNED_WORDS.map(w => w.split('').join('[^a-zA-Z0-9]*')).join('|') + ')',
        'gi'
    );

    // Normalize common leetspeak before checking
    function normalizeLeet(text) {
        return text
            .replace(/[@]/g, 'a')
            .replace(/[3]/g, 'e')
            .replace(/[1!|]/g, 'i')
            .replace(/[0]/g, 'o')
            .replace(/[5$]/g, 's')
            .replace(/[7]/g, 't')
            .replace(/[+]/g, 't')
            .replace(/[\/\\]/g, '');
    }

    function containsProfanity(text) {
        PROFANITY_RE.lastIndex = 0;
        return PROFANITY_RE.test(normalizeLeet(text));
    }

    // censorText — used when WRITING to Firebase (always runs, removes content for everyone).
    // This is the server-side censor: strips truly egregious content from the DB.
    // It only runs on send, not on receive — the per-player display censor is censorForDisplay().
    function censorText(text) {
        const normalized = normalizeLeet(text);
        PROFANITY_RE.lastIndex = 0;
        let result = text;
        const matches = [...normalized.matchAll(new RegExp(PROFANITY_RE.source, 'gi'))];
        if (matches.length > 0) {
            PROFANITY_RE.lastIndex = 0;
            result = text.replace(PROFANITY_RE, m => '*'.repeat(m.length));
            const normCensored = normalized.replace(PROFANITY_RE, m => '*'.repeat(m.length));
            if (normCensored !== normalized) {
                result = text.replace(/./gs, (ch, i) => normCensored[i] === '*' ? '*' : ch);
            }
        }
        return result;
    }

    // censorForDisplay — client-side only, respects chatFilterEnabled.
    // Returns an HTML string: censored words become <span class="chat-censored">***</span>
    // so they're visually distinct (like RS's blue asterisks) rather than plain *** chars.
    function censorForDisplay(text) {
        if (!chatFilterEnabled) return escapeHtml(text);
        const normalized = normalizeLeet(text);
        PROFANITY_RE.lastIndex = 0;
        const normCensored = normalized.replace(PROFANITY_RE, m => '*'.repeat(m.length));
        // Build per-character mask: true = this character is censored
        const mask = [...text].map((_, i) => normCensored[i] === '*');
        // Also run directly on original text for non-leet matches
        PROFANITY_RE.lastIndex = 0;
        const directCensored = text.replace(PROFANITY_RE, (m, _g, offset) => {
            for (let j = offset; j < offset + m.length; j++) mask[j] = true;
            return m;
        });
        // Now build HTML by collapsing consecutive censored chars into one span
        let html = '';
        let i = 0;
        while (i < text.length) {
            if (mask[i]) {
                let j = i;
                while (j < text.length && mask[j]) j++;
                html += '<span class="chat-censored">' + '*'.repeat(j - i) + '</span>';
                i = j;
            } else {
                // Collect consecutive un-censored characters and escape them
                let j = i;
                while (j < text.length && !mask[j]) j++;
                html += escapeHtml(text.slice(i, j));
                i = j;
            }
        }
        return html;
    }

    function generateId()       { return Math.random().toString(36).substr(2, 9); }
    function generateRoomCode() { return Math.random().toString(36).substr(2, 6).toUpperCase(); }
    function hashPassword(pw) {
        // Simple deterministic hash — good enough for a fun game, not a bank
        let h = 5381;
        for (let i = 0; i < pw.length; i++) h = ((h << 5) + h) ^ pw.charCodeAt(i);
        return (h >>> 0).toString(16);
    }
    // Create a unique conversation ID between two usernames (sorted so order doesn't matter)
    function dmConvoId(a, b) {
        return [a, b].map(s => s.toLowerCase()).sort().join('__');
    }

    // ═══════════════════════════════════════════════════════════════
    //  PRESENCE  (global — counts tabs open)
    // ═══════════════════════════════════════════════════════════════
    const sessionId   = Math.random().toString(36).substr(2, 12);
    const presenceRef = database.ref(`presence/${sessionId}`);
    const connectedRef = database.ref('.info/connected');

    connectedRef.on('value', snap => {
        if (snap.val()) {
            presenceRef.onDisconnect().remove();
            presenceRef.set({ ts: Date.now() });
        }
    });

    const MAX_ONLINE_DISPLAY = 100;
    database.ref('presence').on('value', snap => {
        const rawCount = snap.exists() ? Object.keys(snap.val()).length : 0;
        const count = Math.min(rawCount, MAX_ONLINE_DISPLAY);
        const display = count >= MAX_ONLINE_DISPLAY ? `${MAX_ONLINE_DISPLAY}+` : String(count);
        ['activeUsersCount','activeUsersCount2','headerActiveCount'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = display;
        });
    });

    window.addEventListener('beforeunload', () => presenceRef.remove());

    // ═══════════════════════════════════════════════════════════════
    //  INACTIVITY TRACKING
    // ═══════════════════════════════════════════════════════════════
    function recordActivity() {
        lastActivityTime = Date.now();
    }
    ['click','keydown','mousemove','touchstart'].forEach(ev =>
        document.addEventListener(ev, recordActivity, { passive: true })
    );
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) recordActivity();
    });

    // Check inactivity every 5 min — kick if 1 hr passed with no activity
    setInterval(async () => {
        if (!gameId || !playerId) return;
        if (Date.now() - lastActivityTime > INACTIVITY_MS) {
            console.log('Kicking self for inactivity');
            await leaveGame(false, true /* inactivity */);
            await showAlert('You were removed from the table due to 1 hour of inactivity.', '⏰');
        }
    }, 5 * 60 * 1000);

    // ═══════════════════════════════════════════════════════════════
    //  AUTH SYSTEM
    // ═══════════════════════════════════════════════════════════════
    const authScreen    = document.getElementById('authScreen');
    const loginScreen   = document.getElementById('loginScreen');
    const gameScreen    = document.getElementById('gameScreen');
    const authError     = document.getElementById('authError');

    document.getElementById('authTabLogin')?.addEventListener('click', () => {
        document.getElementById('authTabLogin').classList.add('active');
        document.getElementById('authTabRegister').classList.remove('active');
        document.getElementById('loginForm').classList.remove('hidden');
        document.getElementById('registerForm').classList.add('hidden');
        clearAuthError();
    });
    document.getElementById('authTabRegister')?.addEventListener('click', () => {
        document.getElementById('authTabRegister').classList.add('active');
        document.getElementById('authTabLogin').classList.remove('active');
        document.getElementById('registerForm').classList.remove('hidden');
        document.getElementById('loginForm').classList.add('hidden');
        clearAuthError();
    });

    function showAuthError(msg) {
        authError.textContent = msg;
        authError.classList.remove('hidden');
    }
    function clearAuthError() {
        authError.textContent = '';
        authError.classList.add('hidden');
    }

    // Register
    document.getElementById('registerBtn')?.addEventListener('click', async () => {
        const raw = document.getElementById('regUsername').value;
        const pw  = document.getElementById('regPassword').value;
        const pw2 = document.getElementById('regPasswordConfirm').value;
        clearAuthError();

        // Normalize: strip ALL whitespace (start, end, middle) so "a b am" can't fake "abam"
        const un = raw.replace(/\s+/g, '').trim();

        if (!un || un.length < 2) return showAuthError('Username must be at least 2 characters.');
        if (un.length > 10) return showAuthError('Username must be 10 characters or fewer.');
        if (!/^[a-zA-Z0-9_]+$/.test(un)) return showAuthError('Username: letters, numbers, underscores only. No spaces.');
        if (!pw || pw.length < 4)  return showAuthError('Password must be at least 4 characters.');
        if (pw !== pw2) return showAuthError('Passwords do not match.');

        // Duplicate check uses lowercased, space-stripped key
        const userKey = un.toLowerCase();
        const existing = await database.ref(`users/${userKey}`).once('value');
        if (existing.exists()) {
            // Issue #4 fix: a "deleted" account node may linger if the client that
            // performed the deletion also wrote a deletedAccounts tombstone but left
            // the users/ node. Check whether this is a live or a ghost record.
            // A ghost record has a deletedAt timestamp stored under users/${key}/deletedAt
            // OR a matching deletedAccounts/${key} tombstone. In that case, we allow
            // re-registration by overwriting the stale node.
            const existingData = existing.val();
            const tombstoneSnap = await database.ref(`deletedAccounts/${userKey}`).once('value');
            const isGhostRecord = tombstoneSnap.exists() || !!existingData.deletedAt;
            if (!isGhostRecord) return showAuthError('Username already taken.');
            // Clean up the stale tombstone so it doesn't trigger auto-logout
            await database.ref(`deletedAccounts/${userKey}`).remove();
            await database.ref(`chatBans/${userKey}`).remove();
        }

        await database.ref(`users/${userKey}`).set({
            username: un,
            passwordHash: hashPassword(pw),
            createdAt: Date.now(),
            lastSeen: Date.now(),
            isNewUser: true,  // flag — triggers mandatory onboarding
            stats: { roundsPlayed: 0, lastActiveDay: '', streakDays: 0 }
        });

        localStorage.setItem('pokerUsername', un);
        finishLogin(un, userKey, true /* isNew */);
    });

    // Login
    document.getElementById('loginBtn')?.addEventListener('click', doLogin);
    document.getElementById('loginPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

    async function doLogin() {
        const raw = document.getElementById('loginUsername').value;
        const pw  = document.getElementById('loginPassword').value;
        clearAuthError();

        // Same normalization as registration - strip spaces
        const un = raw.replace(/\s+/g, '').trim();

        if (!un || !pw) return showAuthError('Please enter username and password.');

        const userKey = un.toLowerCase();
        const snap = await database.ref(`users/${userKey}`).once('value');
        if (!snap.exists()) return showAuthError('User not found.');

        const data = snap.val();
        if (data.passwordHash !== hashPassword(pw)) return showAuthError('Incorrect password.');

        // Update last seen
        await database.ref(`users/${userKey}/lastSeen`).set(Date.now());
        localStorage.setItem('pokerUsername', un);
        finishLogin(data.username, userKey, false);
    }

    // ── Guest play ──────────────────────────────────────────────────────────
    const GUEST_ADJS  = ['Fluffy','Sneaky','Mighty','Gentle','Blazing','Frozen','Golden','Shadow',
        'Cosmic','Rusty','Neon','Fuzzy','Spicy','Grumpy','Lucky','Clumsy','Jolly','Zippy',
        'Wobbly','Peppy','Salty','Wacky','Breezy','Stormy','Disco','Chunky','Plucky','Bouncy'];
    const GUEST_NOUNS = ['Gorilla','Penguin','Walrus','Panda','Llama','Falcon','Narwhal','Platypus',
        'Bison','Iguana','Mongoose','Axolotl','Capybara','Wombat','Toucan','Manatee','Gecko',
        'Lobster','Hamster','Badger','Raccoon','Marmot','Dingo','Quokka','Otter','Moose'];

    function generateGuestName() {
        const adj  = GUEST_ADJS[Math.floor(Math.random() * GUEST_ADJS.length)];
        const noun = GUEST_NOUNS[Math.floor(Math.random() * GUEST_NOUNS.length)];
        const num  = Math.floor(Math.random() * 90) + 10; // 10–99
        return adj + noun + num;
    }

    document.getElementById('guestBtn')?.addEventListener('click', () => {
        const name = generateGuestName();
        const uid  = 'guest_' + Math.random().toString(36).slice(2, 10);
        // Save so a page refresh keeps the same guest name for the session
        sessionStorage.setItem('pokerGuest', JSON.stringify({ name, uid }));
        finishGuestLogin(name, uid);
    });

    function finishGuestLogin(name, uid) {
        currentUser = { username: name, uid, isGuest: true };
        authScreen.classList.add('hidden');
        document.getElementById('lobbyUsername').textContent = name;
        document.getElementById('guestTag')?.classList.remove('hidden');
        const lvlBadge = document.getElementById('lobbyLevelBadge');
        if (lvlBadge) { lvlBadge.textContent = ''; lvlBadge.style.display = 'none'; }
        // Hide DM button — guests can't DM or GC
        document.getElementById('dmBtn')?.classList.add('hidden');
        // Hide password button — guests have no account
        document.getElementById('changePasswordBtn')?.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        document.getElementById('globalChatWidget').classList.remove('hidden');
        initGlobalChatWidget();
        checkVersionOutdated();
        startRoomCleanup();
        checkRejoin();
        // Guests can see leaderboards but won't appear on them (uid won't match any real user)
        loadLobbyLeaderboards(uid);
        // No streak/level/ban/DM listeners for guests
    }

    async function finishLogin(username, uid, isNewUser = false) {
        currentUser = { username, uid, isGuest: false };
        authScreen.classList.add('hidden');
        document.getElementById('lobbyUsername').textContent = username;
        document.getElementById('guestTag')?.classList.add('hidden');
        document.getElementById('dmBtn')?.classList.remove('hidden');
        document.getElementById('changePasswordBtn')?.classList.remove('hidden');
        const lvlBadgeEl = document.getElementById('lobbyLevelBadge');
        if (lvlBadgeEl) lvlBadgeEl.style.display = '';
        loginScreen.classList.remove('hidden');
        document.getElementById('globalChatWidget').classList.remove('hidden');
        initGlobalChatWidget();
        checkVersionOutdated();
        startRoomCleanup();
        cleanOldGlobalChat();
        cleanOldDMs();
        cleanLongUsernameAccounts();
        checkRejoin();
        listenForDMs();
        // Check if this user is a global game admin
        checkGameAdminStatus(uid);
        // Check if this user has a chat ban — notify them on login
        checkChatBanStatus(uid);
        // Listen for real-time ban events while user is logged in
        listenForBanEvents(uid);
        // Update login streak
        updateLoginStreak(uid);
        // Load lobby mini leaderboards and level badge
        loadLobbyLeaderboards(uid);
        // Listen for real-time bum rank list changes
        database.ref('bum').on('value', snap => {
            bumUsernames.clear();
            if (snap.exists()) {
                const data = snap.val();
                Object.keys(data).forEach(uname => bumUsernames.add(uname.toLowerCase()));
            }
            // Re-render player boxes if in a game so the badge appears/disappears live
            if (gameState) updatePlayers(gameState.players || {});
        });
        // Start DM/group chat notification listener
        setupDmNotificationListener();
        updateMuteBtn();
        // Listen for account deletion — two signals:
        // 1) users/${uid} disappears (primary)
        // 2) deletedAccounts/${uid} tombstone appears (catches edge-cases where
        //    the user node is re-created before the client notices it disappear)
        database.ref(`users/${uid}`).on('value', snap => {
            if (!snap.exists() && currentUser && currentUser.uid === uid) {
                database.ref(`users/${uid}`).off();
                database.ref(`deletedAccounts/${uid}`).off();
                doLogout();
                showAlert('Your account has been deleted. You have been logged out.', '🗑️');
            }
        });
        database.ref(`deletedAccounts/${uid}`).on('value', snap => {
            if (snap.exists() && currentUser && currentUser.uid === uid) {
                database.ref(`users/${uid}`).off();
                database.ref(`deletedAccounts/${uid}`).off();
                doLogout();
                showAlert('Your account has been deleted. You have been logged out.', '🗑️');
            }
        });
        // Show mandatory onboarding for new users
        // Also check DB flag in case localStorage was cleared
        if (isNewUser) {
            showOnboarding();
        } else {
            // Check if they somehow missed onboarding (flag still set in DB)
            try {
                const flagSnap = await database.ref(`users/${uid}/isNewUser`).once('value');
                if (flagSnap.exists() && flagSnap.val() === true) showOnboarding();
            } catch(e) {}
        }
    }

    async function checkChatBanStatus(uid) {
        try {
            const snap = await database.ref(`chatBans/${uid}`).once('value');
            if (!snap.exists()) return;
            const ban = snap.val();
            const now = Date.now();
            if (ban.permanent) {
                // Permanently banned — force logout
                await showAlert(
                    '🚫 Your account has been permanently banned from chat.\n\nYou have been logged out.',
                    '🚫'
                );
                doLogout();
            } else if (ban.until && ban.until > now) {
                const mins = Math.ceil((ban.until - now) / 60000);
                const hrs  = Math.floor(mins / 60);
                const timeStr = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
                await showAlert(
                    `⚠️ Your chat privileges are suspended for ${timeStr}.\n\nYou may still play, but cannot send messages.`,
                    '🔇'
                );
            } else if (ban.until && ban.until <= now) {
                // Ban expired — clean it up
                database.ref(`chatBans/${uid}`).remove().catch(() => {});
            }
        } catch (e) { /* silent */ }
    }

    function listenForBanEvents(uid) {
        // Real-time listener: fires when admin bans this user while they're online
        database.ref(`chatBans/${uid}`).on('value', async snap => {
            if (!snap.exists() || !currentUser) return;
            const ban = snap.val();
            const now = Date.now();
            if (ban.permanent) {
                showAlert(
                    '🚫 You have been permanently banned from chat by an admin.\n\nYou will be logged out now.',
                    '🚫'
                ).then(() => doLogout());
            } else if (ban.until && ban.until > now && !ban._notified) {
                // Mark as notified so we don't re-alert on every Firebase sync
                database.ref(`chatBans/${uid}/_notified`).set(true).catch(() => {});
                const mins = Math.ceil((ban.until - now) / 60000);
                const hrs  = Math.floor(mins / 60);
                const timeStr = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
                await showAlert(
                    `🔇 You have been temporarily banned from chat for ${timeStr} by an admin.\n\nYou may still play, but cannot send messages.`,
                    '🔇'
                );
            }
        });
    }

    let isHeadAdmin = false; // true if user is the Head Game Admin (top level)
    let headAdminUid = '';    // username of the head admin (lowercase)
    let knownGameAdmins = new Set(); // set of known game admin usernames (lowercase)

    async function checkGameAdminStatus(uid) {
        try {
            const snap = await database.ref(`gameAdmins/${uid}`).once('value');
            isGameAdmin = snap.exists() && snap.val() === true;
            // Check for head admin flag
            const headSnap = await database.ref(`headAdmin`).once('value');
            headAdminUid = headSnap.exists() ? String(headSnap.val()).toLowerCase() : '';
            isHeadAdmin = headAdminUid !== '' && headAdminUid === uid;
            if (isHeadAdmin) isGameAdmin = true; // head admin has all game admin powers
            // Cache all game admins for badge rendering
            const gaListSnap = await database.ref('gameAdmins').once('value');
            knownGameAdmins.clear();
            if (gaListSnap.exists()) Object.keys(gaListSnap.val()).forEach(k => knownGameAdmins.add(k.toLowerCase()));
            // Show/hide global admin UI
            const gaBtn = document.getElementById('gameAdminBtn');
            if (gaBtn) gaBtn.classList.toggle('hidden', !isGameAdmin);
        } catch(e) { isGameAdmin = false; isHeadAdmin = false; }
    }
    // To assign yourself as Head Game Admin:
    // In Firebase console: set /headAdmin = "<your_uid>" (your username in lowercase)
    // This grants all game admin powers + ability to act against other game admins.

    // Auto-login on page load
    (async function tryAutoLogin() {
        // Restore guest session first (sessionStorage — clears when tab closes)
        const savedGuest = sessionStorage.getItem('pokerGuest');
        if (savedGuest) {
            try {
                const { name, uid } = JSON.parse(savedGuest);
                if (name && uid) { finishGuestLogin(name, uid); return; }
            } catch(e) { sessionStorage.removeItem('pokerGuest'); }
        }
        const saved = localStorage.getItem('pokerUsername');
        if (!saved) return; // show auth screen
        const userKey = saved.toLowerCase();
        const snap = await database.ref(`users/${userKey}`).once('value');
        if (!snap.exists()) {
            localStorage.removeItem('pokerUsername');
            return;
        }
        const data = snap.val();
        await database.ref(`users/${userKey}/lastSeen`).set(Date.now());
        finishLogin(data.username, userKey, false);
    })();

    // Logout
    function doLogout() {
        // Turn off any active ban listener
        if (currentUser) {
            database.ref(`chatBans/${currentUser.uid}`).off();
        }
        localStorage.removeItem('pokerUsername');
        localStorage.removeItem('pokerId');
        localStorage.removeItem('pokerGameId');
        sessionStorage.removeItem('pokerGuest');
        currentUser = null;
        isGameAdmin = false;
        loginScreen.classList.add('hidden');
        document.getElementById('globalChatWidget').classList.add('hidden');
        authScreen.classList.remove('hidden');
        document.getElementById('loginUsername').value = '';
        document.getElementById('loginPassword').value = '';
        clearAuthError();
    }

    document.getElementById('logoutBtn')?.addEventListener('click', doLogout);

    // ── Change Password (v4.0) ───────────────────────────────────
    document.getElementById('changePasswordBtn')?.addEventListener('click', () => {
        if (!currentUser) return;
        document.getElementById('changePwCurrent').value = '';
        document.getElementById('changePwNew').value = '';
        document.getElementById('changePwConfirm').value = '';
        const errEl = document.getElementById('changePwError');
        errEl.textContent = '';
        errEl.style.display = 'none';
        document.getElementById('changePasswordModal').classList.remove('hidden');
    });
    document.getElementById('changePwCloseBtn')?.addEventListener('click', () => {
        document.getElementById('changePasswordModal').classList.add('hidden');
    });
    document.getElementById('changePwCancelBtn')?.addEventListener('click', () => {
        document.getElementById('changePasswordModal').classList.add('hidden');
    });
    document.getElementById('changePasswordModal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('changePasswordModal'))
            document.getElementById('changePasswordModal').classList.add('hidden');
    });
    document.getElementById('changePwSubmitBtn')?.addEventListener('click', async () => {
        const errEl    = document.getElementById('changePwError');
        const current  = document.getElementById('changePwCurrent').value;
        const newPw    = document.getElementById('changePwNew').value;
        const confirm  = document.getElementById('changePwConfirm').value;
        errEl.textContent = '';
        errEl.style.display = 'none';
        function showPwErr(msg) { errEl.textContent = msg; errEl.style.display = 'block'; }

        if (!current) { showPwErr('Enter your current password.'); return; }
        if (!newPw || newPw.length < 4) { showPwErr('New password must be at least 4 characters.'); return; }
        if (newPw !== confirm) { showPwErr('Passwords do not match.'); return; }
        if (newPw === current) { showPwErr('New password must differ from current password.'); return; }

        // Re-authenticate: fetch fresh user record and verify current password
        try {
            const snap = await database.ref(`users/${currentUser.uid}`).once('value');
            if (!snap.exists()) { showPwErr('Account not found. Please log in again.'); return; }
            const data = snap.val();
            if (data.passwordHash !== hashPassword(current)) {
                showPwErr('Current password is incorrect.');
                return;
            }
            // Prevent a deleted/tombstoned account from changing its password
            const tombSnap = await database.ref(`deletedAccounts/${currentUser.uid}`).once('value');
            if (tombSnap.exists()) { showPwErr('This account has been deleted.'); return; }

            await database.ref(`users/${currentUser.uid}/passwordHash`).set(hashPassword(newPw));
            document.getElementById('changePasswordModal').classList.add('hidden');
            await showAlert('Password updated successfully! ✅', '🔑');
        } catch(err) {
            showPwErr('Error updating password. Please try again.');
            console.error('changePw error:', err);
        }
    });
    // Allow Enter key to submit change password form
    ['changePwCurrent','changePwNew','changePwConfirm'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => {
            if (e.key === 'Enter') document.getElementById('changePwSubmitBtn')?.click();
        });
    });

    // ── Clean up accounts with usernames > 10 chars ──────────────
    async function cleanLongUsernameAccounts() {
        try {
            const snap = await database.ref('users').once('value');
            if (!snap.exists()) return;
            const deletions = [];
            snap.forEach(child => {
                const data = child.val();
                const username = data.username || child.key;
                if (username && username.length > 10) {
                    deletions.push(child.key);
                }
            });
            for (const key of deletions) {
                await database.ref(`users/${key}`).remove();
                await database.ref(`deletedAccounts/${key}`).set({ deletedAt: Date.now(), reason: 'username_too_long' });
                console.log(`Removed account with long username: ${key}`);
            }
        } catch(e) { /* silent */ }
    }

    // ═══════════════════════════════════════════════════════════════
    //  REJOIN LOGIC  (5-minute window)
    // ═══════════════════════════════════════════════════════════════
    async function checkRejoin() {
        const savedGameId  = localStorage.getItem('pokerGameId');
        const savedPlayer  = localStorage.getItem('pokerId');
        if (!savedGameId || !savedPlayer || !currentUser) return;

        // Check if this user was kicked from that room — if so, don't offer rejoin
        const uid = currentUser.uid;
        try {
            const kickSnap = await database.ref(`users/${uid}/kickedFrom`).once('value');
            if (kickSnap.exists()) {
                const kicked = kickSnap.val();
                if (kicked.roomId === savedGameId) {
                    // User was kicked — clear their saved game, clean up kickedFrom record
                    clearSavedGame();
                    database.ref(`users/${uid}/kickedFrom`).remove().catch(() => {});
                    return;
                }
            }
        } catch (e) { /* silent */ }

        const snap = await database.ref(`games/${savedGameId}`).once('value');
        if (!snap.exists()) {
            clearSavedGame();
            return;
        }
        const state = snap.val();
        const pData = state.players && state.players[savedPlayer];
        if (!pData) { clearSavedGame(); return; }

        // Allow rejoin during waiting OR playing status
        const leftAt = pData.leftAt || 0;
        const withinWindow = !pData.leftAt || (Date.now() - leftAt <= REJOIN_WINDOW);

        if (!withinWindow) {
            // Window expired — remove ghost player
            await database.ref(`games/${savedGameId}/players/${savedPlayer}`).remove();
            clearSavedGame();
            return;
        }

        // Offer rejoin
        const statusMsg = state.status === 'playing' ? `(game in progress, $${pData.chips} chips)` : `($${pData.chips} chips)`;
        if (await showConfirm(`Rejoin room "${savedGameId}"?\n\n${statusMsg}`, '🃏')) {
            await rejoinGame(savedGameId, savedPlayer, state);
        } else {
            await database.ref(`games/${savedGameId}/players/${savedPlayer}`).remove();
            clearSavedGame();
        }
    }

    async function rejoinGame(gid, pid, state) {
        gameId     = gid;
        playerId   = pid;
        playerName = currentUser.username;

        // Clear leftAt and mark active atomically — avoids the watchdog seeing
        // a stale leftAt between the remove() and set() calls
        await database.ref(`games/${gid}/players/${pid}`).update({
            leftAt:   null,
            isActive: true,
            lastSeen: firebase.database.ServerValue.TIMESTAMP
        });

        localStorage.setItem('pokerId',   pid);
        localStorage.setItem('pokerGameId', gid);

        setupPresenceTracking();
        listenToGame();
        listenToChat();
        initChatMuteBtns();

        loginScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        document.getElementById('gameCode').textContent = gid;
        document.getElementById('globalChatWidget').classList.add('hidden');

        addLog('You rejoined the game!');

        // If game is in progress, make sure action panel updates correctly
        if (state.status === 'playing') {
            addLog('Game is in progress — you are back at the table.');
        }
    }

    function clearSavedGame() {
        localStorage.removeItem('pokerId');
        localStorage.removeItem('pokerGameId');
    }

    // ═══════════════════════════════════════════════════════════════
    //  LOBBY SCREEN UI EVENTS
    // ═══════════════════════════════════════════════════════════════
    const createRoomBtn    = document.getElementById('createRoomBtn');
    const showJoinBtn      = document.getElementById('showJoinBtn');
    const createRoomOptions = document.getElementById('createRoomOptions');
    const joinRoomOptions  = document.getElementById('joinRoomOptions');
    const maxPlayersSelect = document.getElementById('maxPlayersSelect');
    const roomCodeInput    = document.getElementById('roomCodeInput');
    const confirmCreateBtn = document.getElementById('confirmCreateBtn');
    const confirmJoinBtn   = document.getElementById('confirmJoinBtn');
    const cancelCreateBtn  = document.getElementById('cancelCreateBtn');
    const cancelJoinBtn    = document.getElementById('cancelJoinBtn');

    // Create room in ONE click — default public, no intermediate step needed
    createRoomBtn?.addEventListener('click', () => {
        showCreateRoom();
    });
    showJoinBtn?.addEventListener('click', showJoinRoom);
    confirmCreateBtn?.addEventListener('click', async () => { await createRoom(); });
    confirmJoinBtn?.addEventListener('click', joinRoom);
    cancelCreateBtn?.addEventListener('click', hideRoomOptions);
    cancelJoinBtn?.addEventListener('click', hideRoomOptions);

    document.getElementById('visPublicBtn')?.addEventListener('click', () => setRoomVisibility('public'));
    document.getElementById('visPrivateBtn')?.addEventListener('click', () => setRoomVisibility('private'));

    // ── Game type selector ────────────────────────────────────────
    document.getElementById('gameTypePoker')?.addEventListener('click', () => setGameType('poker'));
    document.getElementById('gameTypeBlackjack')?.addEventListener('click', () => setGameType('blackjack'));
    function setGameType(type) {
        selectedGameType = type;
        document.getElementById('gameTypePoker')?.classList.toggle('active', type === 'poker');
        document.getElementById('gameTypeBlackjack')?.classList.toggle('active', type === 'blackjack');
    }
    document.getElementById('joinTabCode')?.addEventListener('click', () => {
        document.getElementById('joinTabCode').classList.add('active');
        document.getElementById('joinTabBrowse').classList.remove('active');
        document.getElementById('joinByCode').classList.remove('hidden');
        document.getElementById('joinByBrowse').classList.add('hidden');
    });
    document.getElementById('joinTabBrowse')?.addEventListener('click', () => {
        document.getElementById('joinTabCode').classList.remove('active');
        document.getElementById('joinTabBrowse').classList.add('active');
        document.getElementById('joinByCode').classList.add('hidden');
        document.getElementById('joinByBrowse').classList.remove('hidden');
        runLobbyCleanup().then(() => loadPublicRooms());
    });

    // ── Room type tabs (Poker / Blackjack) in Browse Rooms ──────────
    function setRoomTypeBrowse(type) {
        selectedRoomType = type;
        document.getElementById('roomTabPoker')?.classList.toggle('active', type === 'poker');
        document.getElementById('roomTabBlackjack')?.classList.toggle('active', type === 'blackjack');
        loadPublicRooms();
    }
    document.getElementById('roomTabPoker')?.addEventListener('click', () => setRoomTypeBrowse('poker'));
    document.getElementById('roomTabBlackjack')?.addEventListener('click', () => setRoomTypeBrowse('blackjack'));

    function setRoomVisibility(vis) {
        roomVisibility = vis;
        document.getElementById('visPublicBtn')?.classList.toggle('active', vis === 'public');
        document.getElementById('visPrivateBtn')?.classList.toggle('active', vis === 'private');
    }

    function showCreateRoom() {
        if (!currentUser) return;
        hideRoomOptions();
        setGameType('poker'); // reset to default each time panel opens
        createRoomOptions.classList.remove('hidden');
    }
    function showJoinRoom() {
        if (!currentUser) return;
        hideRoomOptions();
        joinRoomOptions.classList.remove('hidden');
        // Default to Browse tab, Poker filter
        document.getElementById('joinTabBrowse').classList.add('active');
        document.getElementById('joinTabCode').classList.remove('active');
        document.getElementById('joinByBrowse').classList.remove('hidden');
        document.getElementById('joinByCode').classList.add('hidden');
        // Reset room-type filter to Poker each time panel opens
        selectedRoomType = 'poker';
        document.getElementById('roomTabPoker')?.classList.add('active');
        document.getElementById('roomTabBlackjack')?.classList.remove('active');
        runLobbyCleanup().then(() => loadPublicRooms());
    }
    function hideRoomOptions() {
        createRoomOptions?.classList.add('hidden');
        joinRoomOptions?.classList.add('hidden');
        const err = document.getElementById('loginError');
        if (err) { err.textContent = ''; err.classList.add('hidden'); }
    }
    function showLobbyError(msg) {
        const err = document.getElementById('loginError');
        if (!err) return;
        err.textContent = msg;
        err.classList.remove('hidden');
    }

    // ═══════════════════════════════════════════════════════════════
    //  GAME SCREEN UI EVENTS
    // ═══════════════════════════════════════════════════════════════
    const leaveGameBtn  = document.getElementById('leaveGameBtn');
    const startGameBtn  = document.getElementById('startGameBtn');
    const actionPanel   = document.getElementById('actionPanel');
    const communityCardsDiv = document.getElementById('communityCards');
    const playerCardsDiv    = document.getElementById('playerCards');
    const playersContainer  = document.getElementById('playersContainer');
    const logContainer      = document.getElementById('logContainer');
    const betSlider   = document.getElementById('betSlider');
    const betInput    = document.getElementById('betInput');
    const betAmount   = betInput; // alias — betAmount used in legacy calls
    const foldBtn     = document.getElementById('foldBtn');
    const checkBtn    = document.getElementById('checkBtn');
    const callBtn     = document.getElementById('callBtn');
    const raiseBtn    = document.getElementById('raiseBtn');
    const chatInput   = document.getElementById('chatInput');
    const sendChatBtn = document.getElementById('sendChatBtn');
    const chatContainer       = document.getElementById('chatContainer');
    const globalChatContainer = document.getElementById('globalChatContainer');
    const rulesBtn    = document.getElementById('rulesBtn');
    const handsBtn    = document.getElementById('handsBtn');
    const rulesModal  = document.getElementById('rulesModal');
    const handsModal  = document.getElementById('handsModal');
    const waitingScreen  = document.getElementById('waitingScreen');
    const versionBadge = document.getElementById('versionBadge');
    const adminBadge   = document.getElementById('adminBadge');

    if (versionBadge) versionBadge.textContent = GAME_VERSION;

    leaveGameBtn?.addEventListener('click', () => leaveGame());
    startGameBtn?.addEventListener('click', async () => {
        // Route to correct start function based on game type
        if (gameState?.gameType === 'blackjack') {
            await bjStartHand();
        } else {
            await startGame();
        }
    });
    // Wrap action buttons with an actionSubmitting guard so rapid double-clicks
    // or a simultaneous autoActOnTimeout never fire two playerAction calls at once.
    function actionBtnHandler(action) {
        if (actionSubmitting) return;
        playerAction(action);
    }
    foldBtn?.addEventListener('click',  () => actionBtnHandler('fold'));
    checkBtn?.addEventListener('click', () => actionBtnHandler('check'));
    callBtn?.addEventListener('click',  () => actionBtnHandler('call'));
    raiseBtn?.addEventListener('click', () => actionBtnHandler('raise'));

    // ── Card Peek Mode (classroom privacy) ───────────────────────
    // Hold SPACE to peek at your cards; release to hide again.
    // Click "Hide/Show" button to toggle the mode on/off.
    let peekModeOn = false;
    const peekToggleBtn = document.getElementById('peekToggleBtn');
    const playerHandSection = document.querySelector('.player-hand');

    function setPeekMode(on) {
        peekModeOn = on;
        if (playerHandSection) playerHandSection.classList.toggle('peek-mode', on);
        if (peekToggleBtn) {
            peekToggleBtn.textContent = on ? '👁 Show' : '👁 Hide';
            peekToggleBtn.style.borderColor = on ? 'rgba(255,193,7,0.5)' : 'rgba(255,255,255,0.25)';
            peekToggleBtn.style.color = on ? '#ffd700' : 'rgba(255,255,255,0.6)';
        }
        // Add/remove hint
        let hint = document.getElementById('peekHint');
        if (on) {
            if (!hint) {
                hint = document.createElement('div');
                hint.id = 'peekHint';
                hint.textContent = 'Hold SPACE to peek at your cards';
                playerHandSection?.appendChild(hint);
            }
        } else {
            hint?.remove();
            playerHandSection?.classList.remove('peeking');
        }
    }

    peekToggleBtn?.addEventListener('click', () => setPeekMode(!peekModeOn));

    document.addEventListener('keydown', e => {
        if (e.code === 'Space' && peekModeOn && playerHandSection) {
            // Don't intercept space when typing in an input
            if (['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
            e.preventDefault();
            playerHandSection.classList.add('peeking');
        }
    });
    document.addEventListener('keyup', e => {
        if (e.code === 'Space' && peekModeOn && playerHandSection) {
            playerHandSection.classList.remove('peeking');
        }
    });
    sendChatBtn?.addEventListener('click', sendChatMessage);
    chatInput?.addEventListener('keypress', e => { if (e.key === 'Enter') sendChatMessage(); });

    document.getElementById('wakeUpBtn')?.addEventListener('click', async () => {
        if (!gameId || !playerId) return;
        await database.ref(`games/${gameId}/players/${playerId}`).update({
            sittingOut: false,
            sitOutPending: false,
            timeoutFolds: 0
        });
        isSittingOutPending = false;
        addLog(`☀️ ${playerName} will return to play from the next hand.`);
        await database.ref(`games/${gameId}/chat`).push({
            senderId: 'system', senderName: '🎲 System',
            message: `☀️ ${playerName} will return to the game next hand.`,
            timestamp: Date.now()
        });
        updateSitOutBtn();
    });

    rulesBtn?.addEventListener('click', () => rulesModal.classList.remove('hidden'));
    handsBtn?.addEventListener('click', () => handsModal.classList.remove('hidden'));
    document.getElementById('bjRulesBtn')?.addEventListener('click', () => document.getElementById('bjRulesModal').classList.remove('hidden'));
    document.getElementById('closeRulesBtn')?.addEventListener('click', () => rulesModal.classList.add('hidden'));
    document.getElementById('closeHandsBtn')?.addEventListener('click', () => handsModal.classList.add('hidden'));
    document.getElementById('closeBjRulesBtn')?.addEventListener('click', () => document.getElementById('bjRulesModal').classList.add('hidden'));
    rulesModal?.addEventListener('click', e => { if (e.target === rulesModal) rulesModal.classList.add('hidden'); });
    handsModal?.addEventListener('click', e => { if (e.target === handsModal) handsModal.classList.add('hidden'); });
    document.getElementById('bjRulesModal')?.addEventListener('click', e => { if (e.target === document.getElementById('bjRulesModal')) document.getElementById('bjRulesModal').classList.add('hidden'); });

    document.getElementById('tabRoom')?.addEventListener('click',   () => switchChatTab('room'));
    document.getElementById('tabGlobal')?.addEventListener('click', () => switchChatTab('global'));
    document.getElementById('tabLog')?.addEventListener('click',    () => switchChatTab('log'));

    // Slider ↔ typable input two-way sync, step-5 enforcement
    function snapToStep5(val, min, max) {
        const snapped = Math.round(val / 5) * 5;
        return Math.max(min, Math.min(max, snapped));
    }
    function syncBetFromSlider() {
        const v = snapToStep5(parseInt(betSlider.value)||0, parseInt(betSlider.min)||0, parseInt(betSlider.max)||0);
        betSlider.value = v;
        if (betInput) { betInput.value = v; betInput.min = betSlider.min; betInput.max = betSlider.max; }
    }
    // While typing: just move the slider to reflect what they've typed so far — no clamping.
    // Clamping only happens on blur so they can freely delete and retype any number.
    function syncBetFromInputLive() {
        const raw = parseInt(betInput.value);
        if (isNaN(raw)) return; // mid-delete — leave slider alone
        const min = parseInt(betSlider.min)||0, max = parseInt(betSlider.max)||0;
        betSlider.value = Math.max(min, Math.min(max, raw)); // clamp slider (it has hard limits)
    }
    // On blur or change: snap to step-5 and clamp. Invalid values go back to minimum.
    function syncBetFromInputCommit() {
        const min = parseInt(betSlider.min)||0, max = parseInt(betSlider.max)||0;
        const raw = parseInt(betInput.value);
        const v   = isNaN(raw) ? min : snapToStep5(raw, min, max);
        betInput.value  = v;
        betSlider.value = v;
    }
    betSlider?.addEventListener('input',  syncBetFromSlider);
    betSlider?.addEventListener('change', syncBetFromSlider);
    betInput?.addEventListener('input',  syncBetFromInputLive);
    betInput?.addEventListener('blur',   syncBetFromInputCommit);
    betInput?.addEventListener('change', syncBetFromInputCommit);

    // ── Admin Panel ──────────────────────────────────────────────
    document.getElementById('adminPanelBtn')?.addEventListener('click', openAdminPanel);
    document.getElementById('closeAdminPanelBtn')?.addEventListener('click', () => {
        document.getElementById('adminPanelModal').classList.add('hidden');
    });
    document.getElementById('adminPanelModal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('adminPanelModal'))
            document.getElementById('adminPanelModal').classList.add('hidden');
    });
    document.getElementById('adminEndGameBtn')?.addEventListener('click', adminEndGame);
    document.getElementById('adminEndRoundBtn')?.addEventListener('click', adminEndRound);
    document.getElementById('adminRestartBtn')?.addEventListener('click', adminRestart);
    document.getElementById('adminForceStartBtn')?.addEventListener('click', adminForceStart);
    document.getElementById('adminVisPublic')?.addEventListener('click', () => {
        database.ref(`games/${gameId}/isPublic`).set(true);
    });
    document.getElementById('adminVisPrivate')?.addEventListener('click', () => {
        database.ref(`games/${gameId}/isPublic`).set(false);
    });

    // ── DM Panel ─────────────────────────────────────────────────
    document.getElementById('gameAdminGameBtn')?.addEventListener('click', openGameAdminPanel);
    document.getElementById('dmBtn')?.addEventListener('click', openDmPanel);
    document.getElementById('lobbyDmBtn')?.addEventListener('click', openDmPanel);
    document.getElementById('closeDmBtn')?.addEventListener('click', () => {
        document.getElementById('dmModal').classList.add('hidden');
    });
    document.getElementById('dmModal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('dmModal'))
            document.getElementById('dmModal').classList.add('hidden');
    });
    document.getElementById('dmSendBtn')?.addEventListener('click', sendDm);
    document.getElementById('dmMessageInput')?.addEventListener('keypress', e => {
        if (e.key === 'Enter') sendDm();
    });
    document.getElementById('dmTabChats')?.addEventListener('click', () => switchDmTab('chats'));
    document.getElementById('dmTabGroups')?.addEventListener('click', () => switchDmTab('groups'));
    document.getElementById('dmTabPlayers')?.addEventListener('click', () => switchDmTab('players'));
    document.getElementById('dmPlayersSearch')?.addEventListener('input', filterDmPlayersList);
    // DM header action buttons — wired here to stay inside closure scope
    document.getElementById('dmMuteBtn')?.addEventListener('click', toggleChatMute);
    document.getElementById('dmAddMemberBtn')?.addEventListener('click', addGroupMember);
    document.getElementById('dmDeleteChatBtn')?.addEventListener('click', deleteChatHistory);
    document.getElementById('muteRoomChatBtn')?.addEventListener('click', toggleRoomChatMute);
    document.getElementById('muteGlobalChatBtn')?.addEventListener('click', toggleGlobalChatMute);
    document.getElementById('chatFilterBtn')?.addEventListener('click', toggleChatFilter);

    // ═══════════════════════════════════════════════════════════════
    //  CREATE / JOIN ROOM
    // ═══════════════════════════════════════════════════════════════
    async function createRoom() {
        if (!currentUser) return;
        const maxPlayers = parseInt(maxPlayersSelect.value);
        playerName = currentUser.username;
        playerId   = currentUser.uid + '_' + generateId();
        gameId     = generateRoomCode();

        try {
            const existing = await database.ref(`games/${gameId}`).once('value');
            if (existing.exists()) gameId = generateRoomCode();

            await database.ref(`games/${gameId}`).set({
                status: 'waiting',
                gameType: selectedGameType,   // 'poker' or 'blackjack'
                players: {},
                pot: 0,
                communityCards: [],
                currentPlayerIndex: 0,
                dealerIndex: 0,
                round: 'preflop',
                currentBet: 0,
                maxPlayers,
                createdAt: Date.now(),
                lastActivity: Date.now(),
                playersActed: {},
                chat: {},
                adminId: playerId,
                isPublic: roomVisibility === 'public',
                createdBy: currentUser.username
            });

            await database.ref(`games/${gameId}/players/${playerId}`).set({
                name: playerName,
                username: currentUser.username,
                chips: 1000,
                bet: 0,
                cards: [],
                folded: false,
                isActive: true,
                joinedAt: Date.now()
            });

            localStorage.setItem('pokerId', playerId);
            localStorage.setItem('pokerGameId', gameId);

            setupPresenceTracking();
            listenToGame();
            listenToChat();
            initChatMuteBtns();
            enterGameScreen();
            addLog(`Room created! Share code: ${gameId}`);
        } catch (err) {
            showLobbyError('Error creating room: ' + err.message);
        }
    }

    async function joinRoom() {
        if (!currentUser) return;
        const roomCode = roomCodeInput.value.trim().toUpperCase();
        if (!roomCode || roomCode.length !== 6) {
            return showLobbyError('Please enter a valid 6-digit room code');
        }

        playerName = currentUser.username;
        gameId     = roomCode;

        try {
            const snap = await database.ref(`games/${gameId}`).once('value');
            if (!snap.exists()) return showLobbyError('Room not found.');
            const game = snap.val();

            // ── Dead room check: if no one is actually active, refuse entry and delete ──
            const activePlayers = Object.values(game.players || {}).filter(p => p.isActive && !p.leftAt);
            if (activePlayers.length === 0) {
                // Room is a ghost — clean it up and reject
                database.ref(`games/${gameId}`).remove().catch(() => {});
                return showLobbyError('That room no longer exists (all players have left).');
            }

            // Check if this user was kicked from this specific room
            const kickSnap = await database.ref(`users/${currentUser.uid}/kickedFrom`).once('value');
            if (kickSnap.exists() && kickSnap.val().roomId === gameId) {
                return showLobbyError('You were kicked from this room and cannot rejoin.');
            }

            // Check if this user already has a player slot (rejoin mid-lobby or mid-game)
            const existingSlot = Object.entries(game.players || {}).find(
                ([, p]) => p.username === currentUser.username
            );
            if (existingSlot) {
                playerId = existingSlot[0];
                await database.ref(`games/${gameId}/players/${playerId}`).update({
                    leftAt:   null,
                    isActive: true,
                    lastSeen: firebase.database.ServerValue.TIMESTAMP
                });
            } else {
                const currentPlayers = Object.values(game.players || {}).filter(p => !p.spectating && !p.pendingAdmit).length;
                const totalSlots = Object.keys(game.players || {}).length;
                if (totalSlots >= 32) return showLobbyError('Room is at maximum capacity.');

                const isGameInProgress = game.status === 'playing';
                if (currentPlayers >= game.maxPlayers && !isGameInProgress) {
                    return showLobbyError(`Room is full (${game.maxPlayers} players max).`);
                }

                playerId = currentUser.uid + '_' + generateId();

                if (isGameInProgress) {
                    // Join as spectator / pending-admit — admin can promote them
                    await database.ref(`games/${gameId}/players/${playerId}`).set({
                        name: playerName,
                        username: currentUser.username,
                        chips: 1000,
                        bet: 0,
                        cards: [],
                        folded: false,
                        isActive: true,
                        joinedAt: Date.now(),
                        spectating: true,
                        pendingAdmit: true,
                        observer: true
                    });
                } else {
                    // status === 'waiting'
                    // Distinguish initial lobby (no deck yet) from between-hands waiting window.
                    // Initial lobby → join freely, no admission needed.
                    // Between hands (deck exists from prior round) → require admin admission
                    // so players can't slip in during the 3-second gap between resetGame and startGame.
                    if (currentPlayers >= game.maxPlayers) return showLobbyError(`Room is full (${game.maxPlayers} players max).`);
                    const isInitialLobby = !game.gameStarted;
                    if (isInitialLobby) {
                        // Free join — no game has started yet
                        await database.ref(`games/${gameId}/players/${playerId}`).set({
                            name: playerName,
                            username: currentUser.username,
                            chips: 1000,
                            bet: 0,
                            cards: [],
                            folded: false,
                            isActive: true,
                            joinedAt: Date.now()
                        });
                    } else {
                        // Between hands — must be admitted by admin
                        await database.ref(`games/${gameId}/players/${playerId}`).set({
                            name: playerName,
                            username: currentUser.username,
                            chips: 1000,
                            bet: 0,
                            cards: [],
                            folded: false,
                            isActive: true,
                            joinedAt: Date.now(),
                            spectating: true,
                            pendingAdmit: true,
                            observer: true
                        });
                    }
                }
            }

            localStorage.setItem('pokerId', playerId);
            localStorage.setItem('pokerGameId', gameId);

            setupPresenceTracking();
            listenToGame();
            listenToChat();
            initChatMuteBtns();
            enterGameScreen();
            addLog(`${playerName} joined the room`);
        } catch (err) {
            showLobbyError('Error joining room: ' + err.message);
        }
    }

    function enterGameScreen() {
        loginScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        document.getElementById('gameCode').textContent = gameId;
        document.getElementById('globalChatWidget').classList.add('hidden');
        // Default: cards hidden — player holds SPACE to peek
        setPeekMode(true);
        // Show correct table type based on room's gameType
        applyGameTypeUI();
    }

    function applyGameTypeUI() {
        const isBJ = gameState?.gameType === 'blackjack';
        const pokerTable  = document.querySelector('.poker-table:not(#bjTable)');
        const bjTable     = document.getElementById('bjTable');
        const rulesBtn    = document.getElementById('rulesBtn');
        const handsBtn    = document.getElementById('handsBtn');
        const bjRulesBtn  = document.getElementById('bjRulesBtn');
        const gameTitle   = document.querySelector('.game-info h2');
        if (pokerTable) pokerTable.classList.toggle('hidden', isBJ);
        if (bjTable)    bjTable.classList.toggle('hidden', !isBJ);
        if (rulesBtn)   rulesBtn.classList.toggle('hidden', isBJ);
        if (handsBtn)   handsBtn.classList.toggle('hidden', isBJ);
        if (bjRulesBtn) bjRulesBtn.classList.toggle('hidden', !isBJ);
        if (gameTitle)  gameTitle.childNodes[0].textContent = isBJ ? 'Blackjack ' : 'Texas Hold\'em Poker ';
    }

    // ═══════════════════════════════════════════════════════════════
    //  PRESENCE TRACKING  (heartbeat + reconnect)
    // ═══════════════════════════════════════════════════════════════
    function setupPresenceTracking() {
        const playerRef = database.ref(`games/${gameId}/players/${playerId}`);

        connectedRef.on('value', snap => {
            if (!snap.val()) return; // offline — onDisconnect hook handles the write

            // Re-register onDisconnect using SERVER timestamps so the value is accurate
            // regardless of when the disconnect fires (fixes stale Date.now() capture).
            playerRef.onDisconnect().update({
                isActive: false,
                lastSeen: firebase.database.ServerValue.TIMESTAMP,
                leftAt:   firebase.database.ServerValue.TIMESTAMP
            });

            // Mark active and — critically — clear any leftAt set by a prior disconnect
            // so other clients stop treating us as gone after a transient blip.
            playerRef.update({
                isActive: true,
                lastSeen: firebase.database.ServerValue.TIMESTAMP,
                leftAt:   null
            }).catch(() => {});
        });

        function sendHeartbeat() {
            if (!gameId || !playerId) return;
            database.ref(`games/${gameId}/players/${playerId}`).update({
                isActive: true,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            }).catch(() => {});
        }
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        // 15s heartbeat — frequent enough vs GONE_THRESHOLD, less noisy than 8s
        heartbeatInterval = setInterval(sendHeartbeat, 15000);

        // Immediate heartbeat on tab focus so re-activation is instant
        const visHandler = () => {
            if (!document.hidden && gameId && playerId) sendHeartbeat();
        };
        document.removeEventListener('visibilitychange', visHandler);
        document.addEventListener('visibilitychange', visHandler);
        // Also send on page focus (separate from visibility)
        window.addEventListener('focus', visHandler);
    }

    // ═══════════════════════════════════════════════════════════════
    //  GAME LISTENERS
    // ═══════════════════════════════════════════════════════════════
    // Firebase can return null briefly during a reconnect. Only leave after
    // several consecutive nulls to avoid a transient blip booting the player.
    let _nullSnapStreak = 0;
    const NULL_SNAP_LIMIT = 4; // ~4 consecutive null snaps before treating as truly gone

    function listenToGame() {
        database.ref(`games/${gameId}`).on('value', snap => {
            gameState = snap.val();
            if (gameState) {
                _nullSnapStreak = 0; // reset on any valid data
                if (gameState.kicked && gameState.kicked[playerId]) {
                    showAlert('You have been kicked from the room by the admin.', '🚫').then(() => leaveGame(true));
                    return;
                }
                // FIX 1: Detect room destruction immediately — don't wait for null-snap debounce.
                // The admin writes `destroyed: true` before removing the room so all clients
                // can cleanly navigate away before the node disappears from Firebase.
                if (gameState.destroyed) {
                    showAlert('This room has been destroyed by the admin.', '💥').then(() => leaveGame(true));
                    return;
                }
                applyGameTypeUI();
                updateUI();

                // Admin rescue: if a non-admin client ran resetGame() and set status→'waiting',
                // the admin client never called resetGame() so its startGame timer was never set.
                // This listener is the only place the admin reliably sees the status change.
                // Also handles BJ auto-advance: bjReset sets status→'waiting' with bjPhase='betting'.
                if (
                    gameState.status === 'waiting' &&
                    gameState.gameStarted &&          // not the initial pre-game lobby
                    (gameState.adminId === playerId || isGameAdmin)
                ) {
                    if (!_autoStartPending) {
                        _autoStartPending = true;
                        setTimeout(async () => {
                            _autoStartPending = false;
                            if (!gameId || !playerId) return;
                            const chk = await database.ref(`games/${gameId}`).once('value');
                            const cs  = chk.val();
                            if (!cs || cs.status !== 'waiting') return;
                            if (cs.adminId !== playerId && !isGameAdmin) return;
                            // BJ rooms restart a new hand; poker rooms use startGame
                            if (cs.gameType === 'blackjack') {
                                await bjStartHand();
                            } else {
                                // Use the same Firebase transaction lock as resetGame's own setTimeout
                                const lockRef = database.ref(`games/${gameId}/status`);
                                let won = false;
                                await lockRef.transaction(current => {
                                    if (current === 'waiting') { won = true; return 'starting'; }
                                    return undefined;
                                });
                                if (!won) return;
                                await startGame();
                            }
                        }, 3000);
                    }
                } else if (gameState.status !== 'waiting') {
                    _autoStartPending = false; // reset flag whenever game is active
                }

                // Notify players about new spectators waiting for admission
                checkForNewPendingAdmits(gameState);
                // Check if current-turn player disconnected — advance if so
                maybeAdvanceTurnForGoneplayer(gameState).catch(e => console.warn('advanceTurn err:', e));
                // Refresh or close admin panel based on whether we're still admin
                const adminModal = document.getElementById('adminPanelModal');
                if (!adminModal.classList.contains('hidden')) {
                    if (gameState.adminId !== playerId) {
                        adminModal.classList.add('hidden');
                    } else {
                        renderAdminPanel();
                    }
                }

                // Admin watchdog: if admin disconnected/left, elect a new one
                maybeElectNewAdmin(gameState);
            } else {
                // Don't leave immediately — Firebase returns null briefly during reconnects.
                // Only leave if we get multiple consecutive nulls (room genuinely deleted).
                _nullSnapStreak++;
                if (_nullSnapStreak >= NULL_SNAP_LIMIT) {
                    leaveGame(true);
                }
            }
        });
    }

    // Watchdog: if the current-turn player disconnected/gone, advance the turn
    async function maybeAdvanceTurnForGoneplayer(state) {
        if (!state || state.status !== 'playing' || !state.currentTurnPlayerId) return;
        const turnPid = state.currentTurnPlayerId;
        const turnPlayer = state.players?.[turnPid];
        if (!turnPlayer) {
            // Player slot is gone — advance the turn immediately
            console.log('Turn player slot gone, advancing turn');
            const nextId = getNextTurnPlayerId(turnPid, state.players || {});
            await database.ref(`games/${gameId}`).update({
                currentTurnPlayerId: nextId,
                turnTimestamp: Date.now(),
                [`players/${turnPid}/folded`]: true
            });
            return;
        }
        const GONE_THRESHOLD = 90000; // 90s — 6 missed heartbeats at 15s interval
        // leftAt is set instantly by onDisconnect but cleared on reconnect.
        // Require it to be >15s old before acting — gives time for a fast reconnect to clear it.
        const leftAtAge = turnPlayer.leftAt ? Date.now() - turnPlayer.leftAt : 0;
        const isGone = (turnPlayer.leftAt && leftAtAge > 15000)
                    || (!turnPlayer.isActive && !turnPlayer.leftAt && turnPlayer.lastSeen && Date.now() - turnPlayer.lastSeen > GONE_THRESHOLD);
        if (!isGone) return;
        // Only the earliest-joining active player acts as leader to avoid race conditions
        const activePlayers = Object.entries(state.players)
            .filter(([id, p]) => id !== turnPid && !p.leftAt && p.isActive)
            .sort(([, a], [, b]) => (a.joinedAt || 0) - (b.joinedAt || 0));
        if (activePlayers.length === 0 || activePlayers[0][0] !== playerId) return;
        console.log('Advancing turn for gone player:', turnPid);
        const updPlayers = { ...state.players };
        updPlayers[turnPid] = { ...updPlayers[turnPid], folded: true };
        const nextId = getNextTurnPlayerId(turnPid, updPlayers);
        const remaining = Object.entries(updPlayers).filter(([, p]) => !p.folded && !p.spectating && !p.pendingAdmit && !p.observer);
        if (remaining.length === 1) {
            await awardPotToPlayer(remaining[0][0]);
            return;
        }
        await database.ref(`games/${gameId}`).update({
            [`players/${turnPid}/folded`]: true,
            currentTurnPlayerId: nextId,
            turnTimestamp: Date.now()
        });
        await database.ref(`games/${gameId}/chat`).push({
            senderId: 'system', senderName: '🎲 System',
            message: `${turnPlayer.name || 'A player'} disconnected — hand auto-folded.`,
            timestamp: Date.now()
        });
    }

    // Elect a new admin if the current one has left/disconnected.
    // To avoid race conditions, only the active player with the earliest joinedAt acts.
    async function maybeElectNewAdmin(state) {
        if (!state || !state.players || !state.adminId) return;
        const adminPlayer = state.players[state.adminId];
        const INACTIVE_THRESHOLD = 90000; // ms — 6 missed heartbeats before admin re-election
        const adminLeftAtAge = adminPlayer?.leftAt ? Date.now() - adminPlayer.leftAt : 0;
        const adminGone = !adminPlayer
            || (adminPlayer.leftAt && adminLeftAtAge > 15000) // only if leftAt is stale, not a fresh blip
            || (!adminPlayer.isActive && !adminPlayer.leftAt && adminPlayer.lastSeen && Date.now() - adminPlayer.lastSeen > INACTIVE_THRESHOLD);
        if (!adminGone) return;

        // Collect active non-admin players, sorted by joinedAt so one client acts as leader
        const activePlayers = Object.entries(state.players)
            .filter(([id, p]) => id !== state.adminId && !p.leftAt && p.isActive)
            .sort(([, a], [, b]) => (a.joinedAt || 0) - (b.joinedAt || 0));

        if (activePlayers.length === 0) return;

        // Only the "leader" (earliest joiner) performs the write to avoid simultaneous writes
        const [leaderId] = activePlayers[0];
        if (leaderId !== playerId) return;

        // Pick a random active player as the new admin
        const newAdmin = activePlayers[Math.floor(Math.random() * activePlayers.length)][0];
        await database.ref(`games/${gameId}/adminId`).set(newAdmin);
        await database.ref(`games/${gameId}/chat`).push({
            senderId: 'system',
            senderName: '🎲 System',
            message: `${state.players[newAdmin]?.name || 'Someone'} is now the room admin (admin left).`,
            timestamp: Date.now()
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  CHAT — with reconnect fix
    // ═══════════════════════════════════════════════════════════════
    let roomChatLoaded   = false;
    let globalChatLoaded = false;

    function listenToChat() {
        // Room chat
        database.ref(`games/${gameId}/chat`).on('child_added', snap => {
            displayChatMessage(snap.val(), 'room');
        });
        // Global chat — reset the key-dedup Set so history loads fresh for this session
        _shownGlobalKeys = new Set();
        subscribeGlobalChat();
    }

    function subscribeGlobalChat() {
        // Detach any existing listener before re-subscribing
        if (globalChatRef) {
            globalChatRef.off('child_added');
        }

        // Load up to 200 historical messages. Use _shownGlobalKeys to deduplicate
        // so that re-subscribes (tab focus, reconnect) never replay already-shown messages.
        globalChatRef = database.ref('globalChat').limitToLast(200);
        globalChatRef.on('child_added', snap => {
            if (_shownGlobalKeys.has(snap.key)) return; // already rendered in this session
            _shownGlobalKeys.add(snap.key);
            const msg = snap.val();
            if (!msg) return;
            if (msg.timestamp > (_lastGlobalChatTs || 0)) _lastGlobalChatTs = msg.timestamp;
            displayChatMessage(msg, 'global');
        });
    }

    // Reconnect global chat when network comes back
    connectedRef.on('value', snap => {
        if (snap.val() && gameId) {
            // Re-subscribe to clear any stale listener state
            setTimeout(() => subscribeGlobalChat(), 500);
        }
    });

    // Also re-subscribe on tab visibility
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && gameId) {
            setTimeout(() => subscribeGlobalChat(), 300);
        }
    });

    function switchChatTab(tab) {
        activeChatTab = tab;
        ['tabRoom','tabGlobal','tabLog'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.toggle('active', el.dataset.tab === tab);
                if (el.dataset.tab === tab) el.classList.remove('has-unread');
            }
        });
        const logEl = document.getElementById('logContainer');
        chatContainer.classList.toggle('hidden', tab !== 'room');
        if (globalChatContainer) globalChatContainer.classList.toggle('hidden', tab !== 'global');
        if (logEl) logEl.classList.toggle('hidden', tab !== 'log');
        const chatInputWrap = document.querySelector('.chat-input-container');
        if (chatInputWrap) chatInputWrap.style.display = tab === 'log' ? 'none' : '';
        // Show the right mute button for the active tab
        const muteRoom   = document.getElementById('muteRoomChatBtn');
        const muteGlobal = document.getElementById('muteGlobalChatBtn');
        if (muteRoom)   muteRoom.style.display   = (tab === 'room')   ? '' : 'none';
        if (muteGlobal) muteGlobal.style.display  = (tab === 'global') ? '' : 'none';
        if (tab === 'room') {
            chatInput.placeholder = 'Message room... (use :emoji:)';
            requestAnimationFrame(() => { chatContainer.scrollTop = chatContainer.scrollHeight; });
        } else if (tab === 'global') {
            chatInput.placeholder = 'Message everyone globally... (use :emoji:)';
            requestAnimationFrame(() => {
                if (globalChatContainer) globalChatContainer.scrollTop = globalChatContainer.scrollHeight;
            });
        } else if (tab === 'log') {
            requestAnimationFrame(() => { if (logEl) logEl.scrollTop = logEl.scrollHeight; });
        }
    }

    async function sendChatMessage() {
        const raw = chatInput.value.trim();
        if (!raw || !gameId || !playerId) return;

        // Check for chat ban
        if (currentUser) {
            const banSnap = await database.ref(`chatBans/${currentUser.uid}`).once('value');
            if (banSnap.exists()) {
                const ban = banSnap.val();
                if (ban.permanent || (ban.until && ban.until > Date.now())) {
                    chatInput.value = '';
                    await showAlert('Your chat privileges have been suspended.', '🔇'); return;
                }
            }
        }

        // Store the raw (un-censored) message in Firebase.
        // Censoring is purely client-side via censorForDisplay() so each player's
        // filter preference applies to what THEY see — exactly like RuneScape.
        const message = applyEmojiShortcuts(raw);
        try {
            if (activeChatTab === 'global') {
                await database.ref('globalChat').push({
                    senderId: playerId,
                    senderName: playerName,
                    username: currentUser?.username,
                    roomCode: gameId,
                    message,
                    timestamp: Date.now()
                });
            } else {
                await database.ref(`games/${gameId}/chat`).push({
                    senderId: playerId,
                    senderName: playerName,
                    message,
                    timestamp: Date.now()
                });
            }
            chatInput.value = '';
        } catch (err) {
            console.error('Chat send error:', err);
        }
    }

    function displayChatMessage(msgData, channel) {
        // System messages about round winners and sit-outs are now shown as on-board overlays/logs
        // — suppress them from the chat panel to avoid clutter.
        // ALL system messages go to game log only — never to room chat
        if (channel === 'room' && msgData.senderId === 'system') {
            // Show in game log tab as log entries
            const logEl = document.getElementById('logContainer');
            if (logEl) {
                const entry = document.createElement('div');
                entry.className = 'log-entry';
                entry.style.color = 'rgba(255,215,0,0.7)';
                entry.style.fontSize = '0.85em';
                const time = new Date(msgData.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                entry.innerHTML = `<span style="opacity:0.5;margin-right:4px;">[${time}]</span>${escapeHtml(msgData.message || '')}`;
                logEl.appendChild(entry);
                if (activeChatTab === 'log') {
                    requestAnimationFrame(() => { logEl.scrollTop = logEl.scrollHeight; });
                }
                const logTabBtn = document.getElementById('tabLog');
                if (logTabBtn && activeChatTab !== 'log') logTabBtn.classList.add('has-unread');
            }
            return;
        }

        const target = channel === 'global' ? globalChatContainer : chatContainer;
        if (!target) return;

        // Respect mute: don't render new messages when channel is muted
        if (channel === 'room'   && roomChatMuted)   return;
        if (channel === 'global' && globalChatMuted) return;

        const div = document.createElement('div');
        div.className = 'chat-message';
        if (msgData.senderId === playerId) div.classList.add('own-message');

        const time = new Date(msgData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const roomTag = (channel === 'global' && msgData.roomCode)
            ? `<span class="room-tag">${escapeHtml(msgData.roomCode)}</span>` : '';

        // Build admin tag for sender — bum rank overrides everything
        let adminTag = '';
        if (msgData.username || msgData.senderName) {
            const senderUid = (msgData.username || msgData.senderName || '').toLowerCase();
            // Bum rank overrides ALL other ranks
            if (senderUid && bumUsernames.has(senderUid)) {
                adminTag = '<span style="background:rgba(139,69,19,0.3);border:1px solid rgba(139,69,19,0.6);border-radius:8px;padding:1px 6px;font-size:0.72em;color:#d4a574;margin-left:3px;">🚮 bum</span>';
            } else if (senderUid && headAdminUid && senderUid === headAdminUid) {
                adminTag = '<span style="background:rgba(255,50,50,0.2);border:1px solid rgba(255,80,80,0.5);border-radius:8px;padding:1px 6px;font-size:0.72em;color:#ff8a80;margin-left:3px;">⭐ Head Admin</span>';
            } else if (senderUid && knownGameAdmins.has(senderUid)) {
                adminTag = '<span style="background:rgba(156,39,176,0.2);border:1px solid rgba(156,39,176,0.5);border-radius:8px;padding:1px 5px;font-size:0.72em;color:#ce93d8;margin-left:3px;">🛡️ Game Admin</span>';
            } else if (gameState?.adminId && gameState.players) {
                const senderPlayerEntry = Object.entries(gameState.players).find(([, p]) => (p.username || '').toLowerCase() === senderUid);
                if (senderPlayerEntry && senderPlayerEntry[0] === gameState.adminId) {
                    adminTag = '<span style="background:rgba(255,193,7,0.2);border:1px solid rgba(255,193,7,0.5);border-radius:8px;padding:1px 5px;font-size:0.72em;color:#ffd700;margin-left:3px;">👑 Room Admin</span>';
                }
            }
        }
        // Store raw (uncensored) text as a data attribute so rerenderChatWithFilter()
        // can toggle censoring on existing messages without a re-fetch from Firebase.
        const rawMsg = msgData.message || '';
        div.innerHTML =
            `<span class="sender">${escapeHtml(msgData.senderName)}:${roomTag}${adminTag}</span>` +
            `<span class="message-text" data-raw="${escapeHtml(rawMsg)}">${censorForDisplay(rawMsg)}</span>` +
            `<span class="timestamp">${time}</span>`;

        target.appendChild(div);
        requestAnimationFrame(() => { target.scrollTop = target.scrollHeight; });

        if (channel === 'global' && activeChatTab !== 'global' && msgData.senderId !== playerId) {
            document.getElementById('tabGlobal')?.classList.add('has-unread');
        }

        // In-app notification for room and global chat messages not sent by us
        if (msgData.senderId !== playerId && msgData.senderId !== 'system') {
            if (channel === 'room' && activeChatTab !== 'room') {
                showChatNotification(msgData.senderName || '?', msgData.message || '', 'room');
            } else if (channel === 'global' && activeChatTab !== 'global') {
                showChatNotification(msgData.senderName || '?', msgData.message || '', 'global');
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  GLOBAL CHAT WIDGET  (lobby screen)
    // ═══════════════════════════════════════════════════════════════
    let gcwListenerRef = null;
    let gcwWidgetInitialized = false; // Track if widget UI/events are already set up
    let onGcwMsgGlobal = null; // Reference for reconnect handlers
    let gcwOpen = true;
    let gcwUnreadCount = 0;

    function initGlobalChatWidget() {
        const gcwMessages = document.getElementById('gcwMessages');
        const gcwInput    = document.getElementById('gcwInput');
        const gcwSendBtn  = document.getElementById('gcwSendBtn');
        const gcwToggle   = document.getElementById('gcwToggle');
        const gcwBody     = document.getElementById('gcwBody');
        const gcwIcon     = document.getElementById('gcwIcon');
        const gcwUnread   = document.getElementById('gcwUnread');
        if (!gcwMessages) return;
        // Pre-populate admin sets so badges show up immediately
        if (!headAdminUid) {
            database.ref('headAdmin').once('value').then(s => {
                if (s.exists()) headAdminUid = String(s.val()).toLowerCase();
            }).catch(() => {});
            database.ref('gameAdmins').once('value').then(s => {
                if (s.exists()) Object.keys(s.val()).forEach(k => knownGameAdmins.add(k.toLowerCase()));
            }).catch(() => {});
        }
        // Always detach old listener before re-subscribing to prevent doubles
        if (gcwListenerRef) {
            gcwListenerRef.off('child_added');
            gcwListenerRef = null;
        }
        gcwListenerActive = false;
        gcwMessages.innerHTML = ''; // Clear to prevent duplicates on re-login
        _shownGcwKeys = new Set();  // Reset so history loads fresh for this session

        // Reset open/unread state on re-login
        gcwOpen = true;
        gcwUnreadCount = 0;
        if (gcwBody) gcwBody.style.display = 'flex';
        if (gcwIcon) gcwIcon.textContent = '▲';

        async function gcwSend(e) {
            if (e?.key && e.key !== 'Enter') return;
            if (!currentUser) return;
            const raw = gcwInput.value.trim();
            if (!raw) return;
            // Check chat ban
            try {
                const banSnap = await database.ref(`chatBans/${currentUser.uid}`).once('value');
                if (banSnap.exists()) {
                    const ban = banSnap.val();
                    if (ban.permanent || (ban.until && ban.until > Date.now())) {
                        gcwInput.value = '';
                        await showAlert('Your chat privileges have been suspended.', '🔇'); return;
                    }
                }
            } catch(e) {}
            // Raw message stored — censoring is client-side only
            database.ref('globalChat').push({
                senderId: currentUser.uid,
                senderName: currentUser.username,
                username: currentUser.username,
                roomCode: null,
                message: applyEmojiShortcuts(raw),
                timestamp: Date.now()
            });
            gcwInput.value = '';
        }
        // Only attach send button handlers once to prevent stacking on re-login
        if (!gcwWidgetInitialized) {
            gcwWidgetInitialized = true;
            gcwToggle?.addEventListener('click', () => {
                gcwOpen = !gcwOpen;
                gcwBody.style.display = gcwOpen ? 'flex' : 'none';
                gcwIcon.textContent = gcwOpen ? '▲' : '▼';
                if (gcwOpen) {
                    gcwUnreadCount = 0;
                    gcwUnread?.classList.add('hidden');
                    gcwMessages.scrollTop = gcwMessages.scrollHeight;
                }
            });
            gcwSendBtn?.addEventListener('click', gcwSend);
            gcwInput?.addEventListener('keypress', gcwSend);
            // Reconnect on visibility/network — registered once globally, not per login
            connectedRef.on('value', snap => {
                if (snap.val() && !gameId && gcwListenerRef) {
                    gcwListenerRef.off('child_added');
                    gcwListenerRef = database.ref('globalChat').limitToLast(100);
                    gcwListenerRef.on('child_added', onGcwMsgGlobal);
                }
            });
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && !gameId && gcwListenerRef) {
                    gcwListenerRef.off('child_added');
                    gcwListenerRef = database.ref('globalChat').limitToLast(100);
                    gcwListenerRef.on('child_added', onGcwMsgGlobal);
                }
            });
        }

        // Subscribe to new messages using its own key-dedup set (separate from in-game global tab)
        gcwListenerRef = database.ref('globalChat').limitToLast(100);
        gcwListenerActive = true;

        function onGcwMsg(snapshot) {
            const msg = snapshot.val();
            if (!msg) return;
            if (_shownGcwKeys.has(snapshot.key)) return; // already rendered in widget — skip replays
            _shownGcwKeys.add(snapshot.key);
            if (msg.timestamp > (_lastGlobalChatTs || 0)) _lastGlobalChatTs = msg.timestamp;
            const div = document.createElement('div');
            div.className = 'gcw-message';
            const isMine = currentUser && msg.username === currentUser.username;
            if (isMine) div.classList.add('gcw-own');
            const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const roomTag = msg.roomCode ? `<span class="room-tag">${escapeHtml(msg.roomCode)}</span>` : '';
            // Build admin badge for global chat widget — bum rank overrides everything
            const senderKey = (msg.username || msg.senderName || '').toLowerCase();
            let gcwAdminTag = '';
            if (senderKey && bumUsernames.has(senderKey)) {
                gcwAdminTag = '<span style="background:rgba(139,69,19,0.3);border:1px solid rgba(139,69,19,0.6);border-radius:8px;padding:1px 6px;font-size:0.72em;color:#d4a574;margin-left:4px;vertical-align:middle;">🚮 bum</span>';
            } else if (senderKey && headAdminUid && senderKey === headAdminUid) {
                gcwAdminTag = '<span style="background:rgba(255,50,50,0.25);border:1px solid rgba(255,80,80,0.5);border-radius:8px;padding:1px 6px;font-size:0.72em;color:#ff8a80;margin-left:4px;vertical-align:middle;">⭐ Head Admin</span>';
            } else if (senderKey && knownGameAdmins.has(senderKey)) {
                gcwAdminTag = '<span style="background:rgba(156,39,176,0.25);border:1px solid rgba(156,39,176,0.5);border-radius:8px;padding:1px 5px;font-size:0.72em;color:#ce93d8;margin-left:4px;vertical-align:middle;">🛡️ Game Admin</span>';
            }
            // Store raw message so rerenderChatWithFilter() can re-censor/uncensor it
            const gcwRawMsg = msg.message || '';
            div.innerHTML =
                `<span class="gcw-sender">${escapeHtml(msg.senderName)}${gcwAdminTag}${roomTag}</span> ` +
                `<span class="gcw-text" data-raw="${escapeHtml(gcwRawMsg)}">${censorForDisplay(gcwRawMsg)}</span> ` +
                `<span class="gcw-time">${time}</span>`;
            gcwMessages.appendChild(div);
            requestAnimationFrame(() => { gcwMessages.scrollTop = gcwMessages.scrollHeight; });
            if (!gcwOpen && !isMine) {
                gcwUnreadCount++;
                if (gcwUnread) {
                    gcwUnread.textContent = gcwUnreadCount > 9 ? '9+' : gcwUnreadCount;
                    gcwUnread.classList.remove('hidden');
                }
            }
        }
        // Alias for use in reconnect handlers (closures above capture onGcwMsg)
        onGcwMsgGlobal = onGcwMsg;

        gcwListenerRef.on('child_added', onGcwMsg);
    }

    // ── Clear global chat messages older than 1 day ──────────────
    async function cleanOldGlobalChat() {
        try {
            const cutoff = Date.now() - GLOBAL_CHAT_TTL;
            const snap = await database.ref('globalChat')
                .orderByChild('timestamp')
                .endAt(cutoff)
                .once('value');
            if (!snap.exists()) return;
            const keys = [];
            snap.forEach(child => keys.push(child.key));
            if (keys.length === 0) return;
            // Delete in small batches to avoid call-stack overflow on large datasets
            const BATCH = 50;
            for (let i = 0; i < keys.length; i += BATCH) {
                const batch = {};
                keys.slice(i, i + BATCH).forEach(k => { batch[k] = null; });
                await database.ref('globalChat').update(batch);
            }
            console.log(`Cleaned ${keys.length} old global chat messages`);
        } catch (e) { /* silent */ }
    }

    // ═══════════════════════════════════════════════════════════════
    //  DM SYSTEM  (v2 — player picker, daily cleanup, lobby access)
    // ═══════════════════════════════════════════════════════════════
    let currentDmTab = 'chats'; // 'chats' | 'players'
    let allRegisteredPlayers = []; // cached for search filter

    function listenForDMs() {
        if (!currentUser) return;
        database.ref('dms').on('child_changed', () => {
            updateDmUnreadBadge();
            // If panel is open, refresh conversations
            if (!document.getElementById('dmModal').classList.contains('hidden') && currentDmTab === 'chats') {
                renderDmConversations();
            }
        });
        database.ref('dms').on('child_added', () => updateDmUnreadBadge());
        updateDmUnreadBadge();
    }

    async function updateDmUnreadBadge() {
        if (!currentUser) return;
        try {
            const snap = await database.ref('dms').once('value');
            let unread = 0;
            if (snap.exists()) {
                snap.forEach(child => {
                    const convo = child.val();
                    if (!convo.participants || !convo.participants[currentUser.uid]) return;
                    const lastRead = (convo.lastRead && convo.lastRead[currentUser.uid]) || 0;
                    if ((convo.lastMsgTs || 0) > lastRead && convo.lastSender !== currentUser.username) unread++;
                });
            }
            ['dmUnreadBadge', 'lobbyDmBadge'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                if (unread > 0) { el.textContent = unread > 9 ? '9+' : unread; el.classList.remove('hidden'); }
                else el.classList.add('hidden');
            });
        } catch (e) {}
    }

    async function openDmPanel() {
        if (currentUser?.isGuest) return;
        document.getElementById('dmModal').classList.remove('hidden');
        // Default to chats tab, but if no convos switch to players
        const snap = await database.ref('dms').once('value');
        let hasConvos = false;
        if (snap.exists()) {
            snap.forEach(child => {
                const c = child.val();
                if (c.participants && c.participants[currentUser.uid]) hasConvos = true;
            });
        }
        switchDmTab(hasConvos ? 'chats' : 'players');
    }

    function switchDmTab(tab) {
        currentDmTab = tab;
        document.getElementById('dmTabChats')?.classList.toggle('active', tab === 'chats');
        document.getElementById('dmTabGroups')?.classList.toggle('active', tab === 'groups');
        document.getElementById('dmTabPlayers')?.classList.toggle('active', tab === 'players');
        document.getElementById('dmConversationsList')?.classList.toggle('hidden', tab !== 'chats');
        document.getElementById('dmGroupsList')?.classList.toggle('hidden', tab !== 'groups');
        document.getElementById('dmPlayersList')?.classList.toggle('hidden', tab !== 'players');

        if (tab === 'chats') renderDmConversations();
        else if (tab === 'groups') renderGroupChats();
        else renderDmPlayersList();
    }

    async function renderDmConversations() {
        const list = document.getElementById('dmConversationsList');
        if (!list || !currentUser) return;
        list.innerHTML = '<div class="dm-loading">Loading...</div>';

        const snap = await database.ref('dms').once('value');
        list.innerHTML = '';

        const convos = [];
        if (snap.exists()) {
            snap.forEach(child => {
                const c = child.val();
                if (c.participants && c.participants[currentUser.uid]) {
                    // iMessage-style: if user cleared this convo and no new messages since, hide it
                    const clearedAt = (c.clearedAt && c.clearedAt[currentUser.uid]) || 0;
                    const lastMsgTs = c.lastMsgTs || 0;
                    if (clearedAt > 0 && lastMsgTs <= clearedAt) return; // hidden until someone messages
                    convos.push({ id: child.key, ...c });
                }
            });
        }

        if (convos.length === 0) {
            list.innerHTML = '<div class="dm-empty-hint">No conversations yet.<br>Go to <strong>Players</strong> tab to start one!</div>';
            return;
        }

        convos.sort((a, b) => (b.lastMsgTs || 0) - (a.lastMsgTs || 0));
        convos.forEach(convo => {
            const otherUserFull = convo.participantNames
                ? Object.values(convo.participantNames).find(n => n !== currentUser.username) || '?'
                : '?';
            const otherUser = truncateName(otherUserFull, 15);
            const lastRead  = (convo.lastRead && convo.lastRead[currentUser.uid]) || 0;
            const hasUnread = (convo.lastMsgTs || 0) > lastRead && convo.lastSender !== currentUser.username;
            const timeStr   = convo.lastMsgTs ? new Date(convo.lastMsgTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

            const row = document.createElement('div');
            row.className = 'dm-convo-row' + (convo.id === activeDmConvoId ? ' dm-active-row' : '');
            row.innerHTML =
                `<div class="dm-convo-avatar">${escapeHtml(otherUserFull[0].toUpperCase())}</div>` +
                `<div class="dm-convo-info">
                    <div class="dm-convo-top">
                        <span class="dm-convo-name" title="${escapeHtml(otherUserFull)}">${escapeHtml(otherUser)}</span>
                        <span class="dm-convo-time">${timeStr}</span>
                    </div>
                    <div class="dm-convo-bottom">
                        <span class="dm-convo-preview">${escapeHtml(convo.lastMsg || 'No messages yet')}</span>
                        ${hasUnread ? '<span class="dm-unread-dot"></span>' : ''}
                    </div>
                </div>`;
            row.addEventListener('click', () => openConversation(convo.id, otherUserFull));
            list.appendChild(row);
        });
    }

    async function renderDmPlayersList() {
        const inner = document.getElementById('dmPlayersInner');
        if (!inner || !currentUser) return;
        inner.innerHTML = '<div class="dm-loading">Loading players...</div>';

        const snap = await database.ref('users').once('value');
        allRegisteredPlayers = [];
        if (snap.exists()) {
            snap.forEach(child => {
                const u = child.val();
                if (u.username && u.username.toLowerCase() !== currentUser.username.toLowerCase()) {
                    allRegisteredPlayers.push({ username: u.username, uid: child.key, lastSeen: u.lastSeen || 0 });
                }
            });
        }

        // Sort by most recently seen
        allRegisteredPlayers.sort((a, b) => b.lastSeen - a.lastSeen);
        renderFilteredPlayers(allRegisteredPlayers);
    }

    function renderFilteredPlayers(players) {
        const inner = document.getElementById('dmPlayersInner');
        if (!inner) return;
        inner.innerHTML = '';

        if (players.length === 0) {
            inner.innerHTML = '<div class="dm-empty-hint">No players found.</div>';
            return;
        }

        players.forEach(p => {
            const isOnline = Date.now() - p.lastSeen < 10 * 60 * 1000;
            const displayName = truncateName(p.username, 6);
            const row = document.createElement('div');
            row.className = 'dm-player-row';
            row.innerHTML =
                `<div class="dm-player-avatar">${escapeHtml(p.username[0].toUpperCase())}</div>` +
                `<div class="dm-player-info">
                    <span class="dm-player-name" title="${escapeHtml(p.username)}">${escapeHtml(displayName)}</span>
                    <span class="dm-player-status ${isOnline ? 'online' : 'offline'}">${isOnline ? '● Online' : '○ Offline'}</span>
                </div>` +
                `<button class="dm-player-msg-btn" data-username="${escapeHtml(p.username)}">Message</button>`;
            row.querySelector('.dm-player-msg-btn').addEventListener('click', () => startDmWithUser(p.username));
            inner.appendChild(row);
        });
    }

    function filterDmPlayersList() {
        const q = document.getElementById('dmPlayersSearch')?.value.trim().toLowerCase() || '';
        const filtered = q ? allRegisteredPlayers.filter(p => p.username.toLowerCase().includes(q)) : allRegisteredPlayers;
        renderFilteredPlayers(filtered);
    }

    async function startDmWithUser(username) {
        if (!currentUser) return;
        if (username.toLowerCase() === currentUser.username.toLowerCase()) return;

        const recipientKey = username.toLowerCase();
        const snap = await database.ref(`users/${recipientKey}`).once('value');
        if (!snap.exists()) { await showAlert(`User "${username}" not found.`, '❌'); return; }

        const recipientData = snap.val();
        const convoId = dmConvoId(currentUser.username, recipientData.username);

        const convoRef  = database.ref(`dms/${convoId}`);
        const convoSnap = await convoRef.once('value');
        if (!convoSnap.exists()) {
            const participants = {};
            participants[currentUser.uid] = true;
            participants[recipientKey]    = true;
            const participantNames = {};
            participantNames[currentUser.uid] = currentUser.username;
            participantNames[recipientKey]    = recipientData.username;
            await convoRef.set({ participants, participantNames, lastMsgTs: 0, lastMsg: '', lastSender: '', createdAt: Date.now() });
        }

        switchDmTab('chats');
        openConversation(convoId, recipientData.username);
    }

    // Legacy alias used elsewhere
    async function startNewDm() {
        const recipientName = document.getElementById('dmNewRecipient')?.value.trim();
        if (recipientName) await startDmWithUser(recipientName);
    }

    function openConversation(convoId, otherUsername) {
        activeDmConvoId = convoId;

        document.getElementById('dmChatHeaderName').textContent = '💬 ' + otherUsername;
        document.getElementById('dmInputRow').classList.remove('hidden');
        document.getElementById('dmEmptyState')?.remove();

        // Show delete button, hide add-member (DMs don't have members to add)
        const addBtn = document.getElementById('dmAddMemberBtn');
        const delBtn = document.getElementById('dmDeleteChatBtn');
        if (addBtn) addBtn.style.display = 'none';
        if (delBtn) delBtn.style.display = '';

        // Re-enable input in case it was locked from a previous GC
        const inputEl = document.getElementById('dmMessageInput');
        const sendBtn = document.getElementById('dmSendBtn');
        if (inputEl) { inputEl.disabled = false; inputEl.placeholder = 'Type a message...'; }
        if (sendBtn) sendBtn.disabled = false;

        const msgArea = document.getElementById('dmMessages');
        msgArea.innerHTML = '';

        // Detach old listener
        if (dmListeners[convoId]) {
            database.ref(`dms/${convoId}/messages`).off('child_added', dmListeners[convoId]);
        }

        // Load clearedAt for this user in this DM
        database.ref(`dms/${convoId}/clearedAt/${currentUser.uid}`).once('value').then(clearedSnap => {
            const clearedAt = clearedSnap.val() || 0;

            const cb = snap => {
                const msg = snap.val();
                if (!msg) return;
                if (msg.timestamp <= clearedAt) return; // hidden by user's delete
                const isMine = msg.senderUsername === currentUser.username;
                const div = document.createElement('div');
                div.className = 'dm-msg' + (isMine ? ' dm-msg-own' : '');
                const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const dmRawText = msg.text || '';
                div.innerHTML =
                    (!isMine ? `<div class="dm-msg-sender">${escapeHtml(msg.senderUsername)}</div>` : '') +
                    `<div class="dm-msg-bubble" data-raw="${escapeHtml(dmRawText)}">${censorForDisplay(dmRawText)}</div>` +
                    `<div class="dm-msg-time">${time}</div>`;
                msgArea.appendChild(div);
                requestAnimationFrame(() => { msgArea.scrollTop = msgArea.scrollHeight; });
            };
            dmListeners[convoId] = cb;
            database.ref(`dms/${convoId}/messages`).limitToLast(100).on('child_added', cb);
        });

        // Mark as read
        database.ref(`dms/${convoId}/lastRead/${currentUser.uid}`).set(Date.now());
        updateDmUnreadBadge();

        // Refresh convo list to remove unread highlight
        if (currentDmTab === 'chats') renderDmConversations();
    }

    // sendDm defined below (supports both DMs and group chats)

    // ── Clean DMs older than 1 day ───────────────────────────────
    async function cleanOldDMs() {
        try {
            const cutoff = Date.now() - GLOBAL_CHAT_TTL;
            const snap = await database.ref('dms').once('value');
            if (!snap.exists()) return;
            snap.forEach(async convoChild => {
                const msgsSnap = await database.ref(`dms/${convoChild.key}/messages`)
                    .orderByChild('timestamp').endAt(cutoff).once('value');
                if (!msgsSnap.exists()) return;
                const deletes = {};
                msgsSnap.forEach(m => { deletes[m.key] = null; });
                await database.ref(`dms/${convoChild.key}/messages`).update(deletes);
            });
        } catch (e) { /* silent */ }
    }

    // ═══════════════════════════════════════════════════════════════
    //  GROUP CHAT
    // ═══════════════════════════════════════════════════════════════
    async function renderGroupChats() {
        const inner = document.getElementById('dmGroupsInner');
        if (!inner || !currentUser) return;
        inner.innerHTML = '<div class="dm-loading">Loading...</div>';

        const snap = await database.ref('groupChats').once('value');
        inner.innerHTML = '';
        const groups = [];
        if (snap.exists()) {
            snap.forEach(child => {
                const g = child.val();
                if (g.members && g.members[currentUser.uid]) {
                    // iMessage-style delete: hide the GC if user cleared it and no new messages since
                    const clearedAt = (g.clearedAt && g.clearedAt[currentUser.uid]) || 0;
                    const lastMsgTs = g.lastMsgTs || 0;
                    if (clearedAt > 0 && lastMsgTs <= clearedAt) return; // hidden until someone messages
                    groups.push({ id: child.key, ...g });
                }
            });
        }

        if (groups.length === 0) {
            inner.innerHTML = '<div class="dm-empty-hint">No group chats yet.<br>Create one above!</div>';
        } else {
            groups.sort((a, b) => (b.lastMsgTs || 0) - (a.lastMsgTs || 0));
            groups.forEach(g => {
                const lastRead = (g.lastRead && g.lastRead[currentUser.uid]) || 0;
                const hasUnread = (g.lastMsgTs || 0) > lastRead && g.lastSender !== currentUser.username;
                const row = document.createElement('div');
                row.className = 'dm-convo-row' + (hasUnread ? ' dm-active-row' : '');
                row.innerHTML = `
                    <div class="dm-convo-avatar">👥</div>
                    <div class="dm-convo-info">
                        <div class="dm-convo-top">
                            <span class="dm-convo-name">${escapeHtml(g.name || 'Group')}</span>
                            ${hasUnread ? '<span class="dm-unread-dot"></span>' : ''}
                        </div>
                        <div class="dm-convo-bottom">
                            <span class="dm-convo-preview">${escapeHtml(g.lastMsg || 'No messages yet')}</span>
                        </div>
                    </div>`;
                row.addEventListener('click', () => openGroupConversation(g.id, g.name || 'Group'));
                inner.appendChild(row);
            });
        }

        // Wire up create group button
        document.getElementById('createGroupBtn')?.addEventListener('click', createGroupChat);
    }

    async function createGroupChat() {
        const name = await new Promise(resolve => {
            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;';
            modal.innerHTML = `<div style="background:#1e2a3a;border-radius:16px;padding:28px;min-width:320px;max-width:400px;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
                <h3 style="margin:0 0 16px;color:#fff;">👥 New Group Chat</h3>
                <input id="_gcNameInput" type="text" maxlength="30" placeholder="Group name..." style="width:100%;padding:10px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:1em;box-sizing:border-box;margin-bottom:16px;">
                <div style="display:flex;gap:10px;">
                    <button id="_gcCreate" style="flex:1;padding:10px;background:rgba(76,175,80,0.3);border:1px solid rgba(76,175,80,0.5);border-radius:8px;color:#81c784;cursor:pointer;font-size:0.95em;">Create</button>
                    <button id="_gcCancel" style="flex:1;padding:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:rgba(255,255,255,0.6);cursor:pointer;font-size:0.95em;">Cancel</button>
                </div>
            </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#_gcCreate').onclick = () => {
                const v = modal.querySelector('#_gcNameInput').value.trim();
                document.body.removeChild(modal);
                resolve(v || null);
            };
            modal.querySelector('#_gcCancel').onclick = () => { document.body.removeChild(modal); resolve(null); };
            modal.querySelector('#_gcNameInput').focus();
            modal.querySelector('#_gcNameInput').addEventListener('keydown', e => {
                if (e.key === 'Enter') modal.querySelector('#_gcCreate').click();
            });
        });
        if (!name) return;

        const gcRef = database.ref('groupChats').push();
        const members = {}; members[currentUser.uid] = currentUser.username;
        await gcRef.set({
            name,
            createdBy: currentUser.uid,
            createdAt: Date.now(),
            members,
            lastMsg: '',
            lastMsgTs: 0,
            lastSender: '',
            lastRead: {}
        });
        renderGroupChats();
        openGroupConversation(gcRef.key, name);
    }

    function openGroupConversation(gcId, gcName) {
        activeDmConvoId = 'gc:' + gcId;

        document.getElementById('dmChatHeaderName').textContent = '👥 ' + gcName;
        document.getElementById('dmInputRow').classList.remove('hidden');
        document.getElementById('dmEmptyState')?.remove();

        // Show add-member and delete buttons for group chats
        const addBtn = document.getElementById('dmAddMemberBtn');
        const delBtn = document.getElementById('dmDeleteChatBtn');
        if (addBtn) addBtn.style.display = '';
        if (delBtn) delBtn.style.display = '';

        const msgArea = document.getElementById('dmMessages');
        msgArea.innerHTML = '';

        if (dmListeners[activeDmConvoId]) {
            database.ref(`groupChats/${gcId}/messages`).off('child_added', dmListeners[activeDmConvoId]);
        }

        // Load this user's clearedAt so we only show messages after it
        database.ref(`groupChats/${gcId}/clearedAt/${currentUser.uid}`).once('value').then(clearedSnap => {
            const clearedAt = clearedSnap.val() || 0;

            // Also check if user can send: they can if there's been a message after their clearedAt
            database.ref(`groupChats/${gcId}/lastMsgTs`).once('value').then(lmSnap => {
                const lastMsgTs = lmSnap.val() || 0;
                const inputEl = document.getElementById('dmMessageInput');
                const sendBtn = document.getElementById('dmSendBtn');
                const lockedByDelete = clearedAt > 0 && lastMsgTs <= clearedAt;
                if (inputEl) {
                    inputEl.disabled = lockedByDelete;
                    inputEl.placeholder = lockedByDelete ? 'Waiting for someone else to message first…' : 'Type a message...';
                }
                if (sendBtn) sendBtn.disabled = lockedByDelete;
            });

            const cb = snap => {
                const msg = snap.val();
                if (!msg) return;
                // Skip messages before this user's clearedAt
                if (msg.timestamp <= clearedAt) return;
                const isMine = msg.senderUid === currentUser.uid;
                const div = document.createElement('div');
                div.className = 'dm-msg' + (isMine ? ' dm-msg-own' : '');
                const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                div.innerHTML =
                    (!isMine ? `<div class="dm-msg-sender">${escapeHtml(msg.senderUsername)}</div>` : '') +
                    `<div class="dm-msg-bubble">${escapeHtml(msg.text)}</div>` +
                    `<div class="dm-msg-time">${time}</div>`;
                msgArea.appendChild(div);
                requestAnimationFrame(() => { msgArea.scrollTop = msgArea.scrollHeight; });

                // If someone else sent a message after the user's clearedAt, unlock input
                if (!isMine && msg.timestamp > clearedAt) {
                    const inputEl = document.getElementById('dmMessageInput');
                    const sendBtn = document.getElementById('dmSendBtn');
                    if (inputEl) { inputEl.disabled = false; inputEl.placeholder = 'Type a message...'; }
                    if (sendBtn) sendBtn.disabled = false;
                }
            };
            dmListeners[activeDmConvoId] = cb;
            database.ref(`groupChats/${gcId}/messages`).limitToLast(100).on('child_added', cb);
        });

        database.ref(`groupChats/${gcId}/lastRead/${currentUser.uid}`).set(Date.now());
        updateMuteBtn();
    }

    // ═══════════════════════════════════════════════════════════════
    //  DELETE CHAT HISTORY  (per-user, local only)
    // ═══════════════════════════════════════════════════════════════
    async function deleteChatHistory() {
        if (!activeDmConvoId || !currentUser) return;
        const isGc = activeDmConvoId.startsWith('gc:');
        const confirmMsg = isGc
            ? 'Delete this group chat?\n\nIt will disappear from your list. It comes back once someone else sends a message — you\'ll be able to read and reply from that point.'
            : 'Delete this conversation?\n\nIt disappears from your list. If they message you again it will reappear.';
        if (!await showConfirm(confirmMsg, '🗑️')) return;

        const now = Date.now();
        if (isGc) {
            const gcId = activeDmConvoId.slice(3);
            await database.ref(`groupChats/${gcId}/clearedAt/${currentUser.uid}`).set(now);
        } else {
            await database.ref(`dms/${activeDmConvoId}/clearedAt/${currentUser.uid}`).set(now);
        }

        // iMessage behavior: close the chat and go back to the list
        activeDmConvoId = null;
        document.getElementById('dmMessages').innerHTML = `
            <div class="dm-empty-state" id="dmEmptyState">
                <div class="dm-empty-icon">💬</div>
                <p>Pick a conversation or start a new one</p>
            </div>`;
        document.getElementById('dmInputRow').classList.add('hidden');
        document.getElementById('dmChatHeaderName').textContent = 'Select a conversation';
        const addBtn = document.getElementById('dmAddMemberBtn');
        const delBtn = document.getElementById('dmDeleteChatBtn');
        if (addBtn) addBtn.style.display = 'none';
        if (delBtn) delBtn.style.display = 'none';

        // Refresh the list — the deleted convo will be filtered out
        if (isGc) {
            switchDmTab('groups');
        } else {
            switchDmTab('chats');
        }
        showToast('🗑️ Conversation deleted');
    }

    // ═══════════════════════════════════════════════════════════════
    //  ADD MEMBER TO GROUP CHAT
    // ═══════════════════════════════════════════════════════════════
    async function addGroupMember() {
        if (!activeDmConvoId?.startsWith('gc:') || !currentUser) return;
        const gcId = activeDmConvoId.slice(3);

        // Load current GC data and all registered players
        const [gcSnap, usersSnap] = await Promise.all([
            database.ref(`groupChats/${gcId}`).once('value'),
            database.ref('users').once('value')
        ]);
        const gc = gcSnap.val();
        if (!gc) return;
        const existingMembers = gc.members || {};

        // Build list of players not already in GC
        const eligible = [];
        usersSnap.forEach(child => {
            const u = child.val();
            if (child.key !== currentUser.uid && !existingMembers[child.key] && u.username) {
                eligible.push({ uid: child.key, username: u.username });
            }
        });

        if (eligible.length === 0) {
            await showAlert('All registered players are already in this group.', '👥');
            return;
        }

        // Show picker modal
        const chosen = await new Promise(resolve => {
            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;';
            const listHtml = eligible.map(p =>
                `<div class="dm-player-row" data-uid="${escapeHtml(p.uid)}" data-name="${escapeHtml(p.username)}" style="padding:10px 14px;cursor:pointer;border-radius:8px;display:flex;align-items:center;gap:10px;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background=''">\
                    <span style="width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;font-size:0.85em;">👤</span>\
                    <span style="color:#fff;">${escapeHtml(p.username)}</span>\
                </div>`
            ).join('');
            modal.innerHTML = `<div style="background:#1e2a3a;border-radius:16px;padding:24px;min-width:300px;max-width:380px;max-height:70vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
                <h3 style="margin:0 0 14px;color:#fff;">➕ Add Member</h3>
                <input id="_gcAddSearch" type="text" placeholder="Search players..." maxlength="20" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:0.9em;box-sizing:border-box;margin-bottom:10px;">
                <div id="_gcAddList" style="overflow-y:auto;flex:1;min-height:0;">${listHtml}</div>
                <button id="_gcAddCancel" style="margin-top:14px;width:100%;padding:9px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:rgba(255,255,255,0.6);cursor:pointer;font-size:0.9em;">Cancel</button>
            </div>`;
            document.body.appendChild(modal);

            modal.querySelector('#_gcAddSearch').addEventListener('input', e => {
                const q = e.target.value.toLowerCase();
                modal.querySelectorAll('.dm-player-row').forEach(row => {
                    row.style.display = row.dataset.name.toLowerCase().includes(q) ? '' : 'none';
                });
            });
            modal.querySelectorAll('.dm-player-row').forEach(row => {
                row.addEventListener('click', () => {
                    document.body.removeChild(modal);
                    resolve({ uid: row.dataset.uid, username: row.dataset.name });
                });
            });
            modal.querySelector('#_gcAddCancel').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(null);
            });
        });

        if (!chosen) return;

        await database.ref(`groupChats/${gcId}/members/${chosen.uid}`).set(chosen.username);
        showToast(`✅ ${chosen.username} added to group`);
        await database.ref(`groupChats/${gcId}/messages`).push({
            senderUid: 'system',
            senderUsername: '🎲 System',
            text: `${currentUser.username} added ${chosen.username} to the group.`,
            timestamp: Date.now()
        });
        // Re-open conversation to reload
        const headerName = document.getElementById('dmChatHeaderName').textContent.replace('👥 ', '');
        openGroupConversation(gcId, headerName);
    }

    // ═══════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════
    let chatMuted       = localStorage.getItem('chatMuted')       === 'true';
    let roomChatMuted   = localStorage.getItem('roomChatMuted')   === 'true';
    let globalChatMuted = localStorage.getItem('globalChatMuted') === 'true';

    function toggleChatMute() {
        chatMuted = !chatMuted;
        localStorage.setItem('chatMuted', chatMuted);
        updateMuteBtn();
        showToast(chatMuted ? '🔇 Chat notifications muted' : '🔔 Chat notifications on');
    }

    function toggleRoomChatMute() {
        roomChatMuted = !roomChatMuted;
        localStorage.setItem('roomChatMuted', roomChatMuted);
        const btn = document.getElementById('muteRoomChatBtn');
        if (btn) { btn.textContent = roomChatMuted ? '🔇' : '🔔'; btn.title = roomChatMuted ? 'Room chat muted — click to unmute' : 'Mute room chat'; btn.style.opacity = roomChatMuted ? '1' : '0.55'; }
        showToast(roomChatMuted ? '🔇 Room chat muted' : '🔔 Room chat unmuted');
    }

    function toggleGlobalChatMute() {
        globalChatMuted = !globalChatMuted;
        localStorage.setItem('globalChatMuted', globalChatMuted);
        const btn = document.getElementById('muteGlobalChatBtn');
        if (btn) { btn.textContent = globalChatMuted ? '🔇' : '🔔'; btn.title = globalChatMuted ? 'Global chat muted — click to unmute' : 'Mute global chat'; btn.style.opacity = globalChatMuted ? '1' : '0.55'; }
        showToast(globalChatMuted ? '🔇 Global chat muted' : '🔔 Global chat unmuted');
    }

    function initChatMuteBtns() {
        const roomBtn   = document.getElementById('muteRoomChatBtn');
        const globalBtn = document.getElementById('muteGlobalChatBtn');
        if (roomBtn)   { roomBtn.textContent   = roomChatMuted   ? '🔇' : '🔔'; roomBtn.style.opacity   = roomChatMuted   ? '1' : '0.55'; }
        if (globalBtn) { globalBtn.textContent = globalChatMuted ? '🔇' : '🔔'; globalBtn.style.opacity = globalChatMuted ? '1' : '0.55'; }
        // Sync the filter button to the player's saved preference
        updateChatFilterBtn();
    }

    function updateMuteBtn() {
        const btn = document.getElementById('dmMuteBtn');
        if (btn) { btn.textContent = chatMuted ? '🔇' : '🔔'; btn.title = chatMuted ? 'Notifications muted — click to unmute' : 'Notifications on — click to mute'; }
    }

    // Lightweight toast for feedback
    function showToast(msg, duration = 2500) {
        let el = document.getElementById('_chatToast');
        if (!el) {
            el = document.createElement('div');
            el.id = '_chatToast';
            el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(30,42,58,0.97);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:10px 20px;border-radius:30px;font-size:0.9em;z-index:99999;pointer-events:none;transition:opacity 0.3s;';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.opacity = '1';
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.opacity = '0'; }, duration);
    }

    // In-app notification banner for incoming messages
    function showChatNotification(from, preview, type) {
        if (chatMuted) return;
        // Don't notify if DM panel is open
        if (!document.getElementById('dmModal').classList.contains('hidden')) return;

        let banner = document.getElementById('_chatNotifBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = '_chatNotifBanner';
            banner.style.cssText = 'position:fixed;top:16px;right:16px;max-width:300px;background:rgba(20,30,45,0.97);border:1px solid rgba(76,175,80,0.3);border-radius:12px;padding:12px 16px;z-index:99998;cursor:pointer;box-shadow:0 8px 32px rgba(0,0,0,0.4);transition:opacity 0.3s;';
            document.body.appendChild(banner);
        }
        const icon = type === 'dm' ? '💬' : type === 'group' ? '👥' : type === 'room' ? '🃏' : '🌍';
        banner.innerHTML = `<div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:1.3em;">${icon}</span>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:bold;font-size:0.85em;color:#a5d6a7;">${escapeHtml(from)}</div>
                <div style="font-size:0.8em;color:rgba(255,255,255,0.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(preview.substring(0,60))}</div>
            </div>
            <button onclick="document.getElementById('_chatNotifBanner').style.opacity='0'" style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:1em;padding:0 4px;">✕</button>
        </div>`;
        banner.style.opacity = '1';
        banner.onclick = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            banner.style.opacity = '0';
            openDmPanel();
        };
        clearTimeout(banner._t);
        banner._t = setTimeout(() => { banner.style.opacity = '0'; }, 5000);
    }

    // Listen for incoming DMs and notify
    function setupDmNotificationListener() {
        if (!currentUser) return;
        database.ref('dms').on('child_changed', async snap => {
            const convo = snap.val();
            if (!convo || !convo.participants || !convo.participants[currentUser.uid]) return;
            if (convo.lastSender === currentUser.username) return;
            const lastRead = (convo.lastRead && convo.lastRead[currentUser.uid]) || 0;
            if ((convo.lastMsgTs || 0) <= lastRead) return;
            const otherName = convo.participantNames
                ? Object.values(convo.participantNames).find(n => n !== currentUser.username) || 'Someone'
                : 'Someone';
            showChatNotification(otherName, convo.lastMsg || '…', 'dm');
            // If the DM panel is open on Chats tab, refresh so a previously-deleted
            // convo reappears now that someone messaged after the clearedAt point
            if (!document.getElementById('dmModal').classList.contains('hidden') && currentDmTab === 'chats') {
                renderDmConversations();
            }
        });
        // Group chat notifications
        database.ref('groupChats').on('child_changed', async snap => {
            const g = snap.val();
            if (!g || !g.members || !g.members[currentUser.uid]) return;
            if (g.lastSender === currentUser.username) return;
            const lastRead = (g.lastRead && g.lastRead[currentUser.uid]) || 0;
            if ((g.lastMsgTs || 0) <= lastRead) return;
            showChatNotification(g.name || 'Group', g.lastMsg || '…', 'group');
            // Refresh groups list so a deleted GC reappears when someone messages
            if (!document.getElementById('dmModal').classList.contains('hidden') && currentDmTab === 'groups') {
                renderGroupChats();
            }
        });
    }

    // Patch sendDm to update group chats too
    async function sendDm() {
        if (!activeDmConvoId || !currentUser) return;
        const input = document.getElementById('dmMessageInput');
        const text  = input?.value.trim();
        if (!text) return;

        try {
            const banSnap = await database.ref(`chatBans/${currentUser.uid}`).once('value');
            if (banSnap.exists()) {
                const ban = banSnap.val();
                if (ban.permanent || (ban.until && ban.until > Date.now())) {
                    if (input) input.value = '';
                    await showAlert('Your chat privileges have been suspended.', '🔇'); return;
                }
            }
        } catch(e) {}

        // Raw message stored — censoring is client-side only
        const cleaned = applyEmojiShortcuts(text);
        const msg = {
            senderUid:      currentUser.uid,
            senderUsername: currentUser.username,
            text:           cleaned,
            timestamp:      Date.now()
        };

        if (activeDmConvoId.startsWith('gc:')) {
            // Group chat
            const gcId = activeDmConvoId.slice(3);
            await database.ref(`groupChats/${gcId}/messages`).push(msg);
            await database.ref(`groupChats/${gcId}`).update({
                lastMsg:    cleaned.length > 50 ? cleaned.substring(0, 50) + '…' : cleaned,
                lastMsgTs:  Date.now(),
                lastSender: currentUser.username
            });
        } else {
            // DM
            await database.ref(`dms/${activeDmConvoId}/messages`).push(msg);
            await database.ref(`dms/${activeDmConvoId}`).update({
                lastMsg:    cleaned.length > 50 ? cleaned.substring(0, 50) + '…' : cleaned,
                lastMsgTs:  Date.now(),
                lastSender: currentUser.username
            });
        }
        if (input) input.value = '';
    }

    // ═══════════════════════════════════════════════════════════════
    //  ADMIN PANEL
    // ═══════════════════════════════════════════════════════════════
    async function openAdminPanel() {
        // FIX 6: Allow both the room admin AND game admins to access the admin panel
        if (!gameState || (gameState.adminId !== playerId && !isGameAdmin)) return;
        document.getElementById('adminPanelModal').classList.remove('hidden');
        renderAdminPanel();
    }

    function renderAdminPanel() {
        // FIX 6: Allow room admin OR game admin to render the panel
        if (!gameState || (gameState.adminId !== playerId && !isGameAdmin)) return;
        const players = gameState.players || {};
        const table   = document.getElementById('adminPlayerTable');
        if (!table) return;
        table.innerHTML = '';

        // ── Pending admits at top — clean card design ──────────
        const pending = Object.entries(players).filter(([, p]) => p.pendingAdmit && p.name);
        if (pending.length > 0) {
            const section = document.createElement('div');
            section.className = 'apf-spectator-section';
            section.innerHTML = `<div class="apf-spectator-header">
                <span>👁️ Spectator Queue</span>
                <span class="apf-count-badge">${pending.length}</span>
            </div>`;
            for (const [pid, p] of pending) {
                const row = document.createElement('div');
                row.className = 'apf-spectator-row';
                row.innerHTML = `
                    <div class="apf-spectator-name">
                        ${escapeHtml(p.name)}
                        <span class="apf-spectator-label">watching</span>
                    </div>
                    <div class="apf-spectator-actions">
                        <button class="apf-admit" data-pid="${pid}">✅ Admit</button>
                        <button class="apf-kick" data-pid="${pid}">❌ Reject</button>
                    </div>`;
                section.appendChild(row);
            }
            const helpText = document.createElement('div');
            helpText.style.cssText = 'font-size:0.75em;color:rgba(255,255,255,0.4);margin-top:8px;line-height:1.5;';
            helpText.textContent = 'Admitted players join as sitting-out from the next hand.';
            section.appendChild(helpText);
            table.appendChild(section);
            const sep = document.createElement('div');
            sep.className = 'apf-separator';
            table.appendChild(sep);
        }

        // ── Active players ─────────────────────────────────────
        Object.entries(players).filter(([, p]) => p.name && !p.pendingAdmit).forEach(([pid, p]) => {
            const row = document.createElement('div');
            row.className = 'admin-player-row-full';
            const isMe = pid === playerId;
            const statusTag = p.sittingOut ? ' <span style="font-size:0.75em;color:#ffb74d;">💤</span>' :
                              p.observer   ? ' <span style="font-size:0.75em;color:rgba(255,255,255,0.4);">👀</span>' : '';
            row.innerHTML =
                `<span class="apf-name">${escapeHtml(p.name)}${isMe ? ' <span class="you-tag">(You)</span>' : ''}${statusTag}</span>` +
                `<span class="apf-chips">$${p.chips}</span>` +
                (!isMe ? `<div class="apf-actions">
                    <button class="apf-promote" data-pid="${pid}" title="Make admin">👑 Promote</button>
                    <button class="apf-sitout ${(p.sittingOut || p.sitOutPending) ? 'disabled' : ''}" data-pid="${pid}" ${(p.sittingOut || p.sitOutPending) ? `disabled title="${p.sittingOut ? 'Player is already sitting out' : 'Sit-out request already sent'}"` : 'title="Sit this player out next hand"'}>💤 Sit Out</button>
                    <button class="apf-kick" data-pid="${pid}">🚫 Kick</button>
                </div>` : '');
            table.appendChild(row);
        });

        table.querySelectorAll('.apf-admit').forEach(btn =>
            btn.addEventListener('click', () => admitSpectator(btn.dataset.pid))
        );
        table.querySelectorAll('.apf-kick').forEach(btn =>
            btn.addEventListener('click', () => kickPlayer(btn.dataset.pid))
        );
        table.querySelectorAll('.apf-sitout').forEach(btn =>
            btn.addEventListener('click', () => { if (!btn.disabled) adminSitOutPlayer(btn.dataset.pid); })
        );
        table.querySelectorAll('.apf-promote').forEach(btn =>
            btn.addEventListener('click', async () => {
                if (await showConfirm(`Make ${players[btn.dataset.pid]?.name} the room admin?`, '👑'))
                    promotePlayer(btn.dataset.pid);
            })
        );

        // Sync visibility buttons
        const isPublic = gameState.isPublic !== false;
        document.getElementById('adminVisPublic')?.classList.toggle('active', isPublic);
        document.getElementById('adminVisPrivate')?.classList.toggle('active', !isPublic);
    }

    async function adminEndGame() {
        // Allow room admin OR game admin in-room to destroy
        if (!gameState || (gameState.adminId !== playerId && !isGameAdmin)) return;
        if (!await showConfirm('💥 DESTROY this room?\n\nAll players will be kicked back to the lobby and the room will be permanently deleted.', '💥')) return;
        // FIX: Write a `destroyed` flag FIRST so all connected clients detect it
        // immediately via their listenToGame listener and call leaveGame(true).
        // Without this, clients only see a null snap after the room is deleted,
        // but the null-snap debounce (NULL_SNAP_LIMIT=4) delays them by ~4 ticks.
        await database.ref(`games/${gameId}/destroyed`).set(true);
        // Brief delay so the flag propagates to all clients before the room is removed
        await new Promise(r => setTimeout(r, 800));
        // Now delete the room — clients already navigated away
        await database.ref(`games/${gameId}`).remove();
    }

    async function adminEndRound() {
        // FIX 6: Allow room admin OR game admin
        if (!gameState || (gameState.adminId !== playerId && !isGameAdmin)) return;
        if (!await showConfirm('🏠 End the current game and return everyone to the lobby?\n\nAll players keep their spots and get $1000 chips. New players can join before the next game starts.', '🏠')) return;
        document.getElementById('adminPanelModal').classList.add('hidden');
        await backToLobby();
    }

    async function adminRestart() {
        // FIX 6: Allow room admin OR game admin
        if (!gameState || (gameState.adminId !== playerId && !isGameAdmin)) return;
        if (!await showConfirm('Restart the game?\nAll players will get fresh $1000 chips.', '🔄')) return;
        await playAgain();
    }

    async function adminForceStart() {
        // FIX 6: Allow room admin OR game admin
        if (!gameState || (gameState.adminId !== playerId && !isGameAdmin)) return;
        // If we're in a between-hands waiting state (deck exists), clear it first so startGame works cleanly
        if (gameState.deck) {
            await database.ref(`games/${gameId}`).update({
                status: 'waiting',
                deck: null,
                communityCards: [],
                currentBet: 0,
                round: 'preflop',
                playersActed: {},
                pot: 0
            });
            // Reset player hands
            const players = gameState.players || {};
            const resetUpd = {};
            for (const pid of Object.keys(players)) {
                resetUpd[`games/${gameId}/players/${pid}/cards`] = [];
                resetUpd[`games/${gameId}/players/${pid}/bet`] = 0;
                resetUpd[`games/${gameId}/players/${pid}/folded`] = false;
                resetUpd[`games/${gameId}/players/${pid}/revealedCards`] = null;
                resetUpd[`games/${gameId}/players/${pid}/handName`] = null;
            }
            await database.ref().update(resetUpd);
            await new Promise(r => setTimeout(r, 300));
        }
        await startGame();
    }

    // ═══════════════════════════════════════════════════════════════
    //  UI UPDATE
    // ═══════════════════════════════════════════════════════════════
    function updateUI() {
        // Show sit-out toggle button whenever player is in an active game
        const sitOutWrap = document.getElementById('sitOutBtnWrap');
        if (sitOutWrap) {
            const _cur = gameState?.players?.[playerId];
            // Never show sit-out button when it's your turn — prevents the state machine
        // from entering an undefined state (sittingOut=true with active turn)
        const isMyActiveTurn = gameState?.currentTurnPlayerId === playerId;
        const showSitOut = gameState?.status === 'playing' && _cur && !_cur.sittingOut && !isMyActiveTurn;
        sitOutWrap.classList.toggle('hidden', !showSitOut);
        if (showSitOut) updateSitOutBtn();
        }
        if (!gameState) return;

        const players   = gameState.players || {};
        const playerIds = Object.keys(players);
        const isAdmin   = gameState.adminId === playerId;

        const now = Date.now();
        const realPlayerCount = playerIds.filter(id => {
            const p = players[id];
            return !p.leftAt || (now - p.leftAt) < REJOIN_WINDOW;
        }).length;
        document.getElementById('playerCount').textContent =
            `${realPlayerCount}/${gameState.maxPlayers}`;

        if (adminBadge)         adminBadge.classList.toggle('hidden', !isAdmin);
        const adminPanelBtn = document.getElementById('adminPanelBtn');
        // FIX 6: Show admin panel button for room admin OR game admin
        if (adminPanelBtn) adminPanelBtn.classList.toggle('hidden', !isAdmin && !isGameAdmin);
        const gameAdminGameBtn = document.getElementById('gameAdminGameBtn');
        if (gameAdminGameBtn) gameAdminGameBtn.classList.toggle('hidden', !isGameAdmin);

        // Game Over
        const gameOverEl = document.getElementById('gameOverScreen');
        if (gameState.status === 'gameover') {
            waitingScreen.classList.add('hidden');
            actionPanel.classList.add('hidden');
            document.getElementById('sittingOutPanel')?.classList.add('hidden');
            if (!gameOverEl) {
                const overlay = document.createElement('div');
                overlay.id        = 'gameOverScreen';
                overlay.className = 'waiting-screen game-over-screen';
                const winnerId   = gameState.gameWinner;
                const winnerName = winnerId && players[winnerId] ? players[winnerId].name : 'Someone';
                const winnerChips = winnerId && players[winnerId] ? players[winnerId].chips : 0;
                const isWinner   = winnerId === playerId;
                const isAdmin    = gameState.adminId === playerId;
                const activeCnt  = Object.values(players).filter(p => p.chips > 0 && !p.sittingOut && !p.spectating && !p.pendingAdmit && !p.leftAt).length;
                const gameEndReason = activeCnt <= 1 ? 'All other players are bankrupt or have sat out.' : 'All other players went bankrupt.';
                overlay.innerHTML =
                    '<div class="crown-icon">👑</div>' +
                    `<h2 class="${isWinner ? 'winner-text' : ''}">${escapeHtml(winnerName)} wins the game!</h2>` +
                    `<p style="margin:6px 0;opacity:0.8;color:#ffd700;font-size:1.1em;">💰 Final chips: $${winnerChips}</p>` +
                    '<p style="margin:10px 0;opacity:0.8;">' + gameEndReason + '</p>' +
                    '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:14px;">' +
                    '<button id="backToLobbyBtn" class="start-btn play-again-btn" style="background:linear-gradient(135deg,#4CAF50,#2e7d32);">🏠 Back to Lobby (New Game)</button>' +
                    (isAdmin ? '<button id="playAgainBtn" class="start-btn play-again-btn">🔄 Play Again (Reset $1000)</button>' : '') +
                    '</div>';
                document.querySelector('.poker-table').appendChild(overlay);
                document.getElementById('backToLobbyBtn')?.addEventListener('click', backToLobby);
                document.getElementById('playAgainBtn')?.addEventListener('click', playAgain);
            }
            updatePlayers(players);
            updateWinnerHighlight();
            return;
        }

        if (gameOverEl) gameOverEl.remove();
        const myHandSection = document.querySelector('.player-hand');
        if (myHandSection) {
            myHandSection.classList.remove('game-winner-me');
            // Only clear round-winner styling when there's no active roundWinner
            // (during showdown, status is still 'playing' but we want to keep the highlight)
            if (!gameState.roundWinner) {
                myHandSection.classList.remove('round-winner-me');
                document.getElementById('myRoundWinnerLabel')?.remove();
            }
        }
        const existingCrown = document.getElementById('myWinnerLabel');
        if (existingCrown) existingCrown.remove();

        // Waiting — only show the waiting overlay in the INITIAL lobby (no deck yet).
        // Between rounds, status briefly becomes 'waiting' before auto-starting the next hand.
        // We must NOT show the overlay then — it causes a jarring flicker mid-game.
        const isInitialLobby = !gameState.gameStarted;
        const isBJGame = gameState.gameType === 'blackjack';
        if (gameState.status === 'waiting') {
            // BJ has its own waiting UI inside updateBJUI — never show the poker waiting overlay
            if (isInitialLobby && !isBJGame) {
                waitingScreen.classList.remove('hidden');
            } else {
                waitingScreen.classList.add('hidden');
            }
            actionPanel.classList.add('hidden');

            // BJ can start with 1 player; poker requires 2
            const hasEnough = isBJGame ? playerIds.length >= 1 : playerIds.length >= 2;

            if (isAdmin && hasEnough && isInitialLobby) {
                startGameBtn.classList.remove('hidden');
            } else {
                startGameBtn.classList.add('hidden');
            }

            // Admin player list in waiting screen (only in initial lobby)
            const adminList = document.getElementById('adminPlayerList');
            if (adminList) {
                if (isAdmin && isInitialLobby) {
                    adminList.classList.remove('hidden');
                    adminList.innerHTML = '<div style="font-size:0.85em;margin-bottom:8px;opacity:0.7;">👑 Players in room (use Admin Panel for management):</div>';
                    playerIds.forEach(pid => {
                        const p = players[pid];
                        const row = document.createElement('div');
                        row.className = 'admin-player-row';
                        row.innerHTML = pid === playerId
                            ? `<span>${escapeHtml(p.name)} <span class="you-tag">(You)</span></span>`
                            : `<span>${escapeHtml(p.name)}</span>
                               <div class="admin-row-btns">
                                 <button class="promote-btn" data-pid="${pid}" title="Make admin">👑</button>
                                 <button class="kick-btn" data-pid="${pid}">Kick</button>
                               </div>`;
                        adminList.appendChild(row);
                    });
                    adminList.querySelectorAll('.kick-btn').forEach(b =>
                        b.addEventListener('click', () => kickPlayer(b.dataset.pid)));
                    adminList.querySelectorAll('.promote-btn').forEach(b =>
                        b.addEventListener('click', () => promotePlayer(b.dataset.pid)));
                } else {
                    adminList.classList.add('hidden');
                }
            }
        } else {
            waitingScreen.classList.add('hidden');
            const adminList = document.getElementById('adminPlayerList');
            if (adminList) adminList.innerHTML = '';
        }

        document.getElementById('potAmount').textContent = gameState.pot || 0;
        updateCommunityCards(gameState.communityCards || []);
        updatePlayers(players);

        // Blackjack rooms: delegate to BJ UI updater and skip poker panel
        if (gameState.gameType === 'blackjack') {
            updateBJUI();
            return;
        }

        const currentPlayer = players[playerId];
        if (currentPlayer) {
            updatePlayerHand(currentPlayer.cards || []);
            document.getElementById('playerChips').textContent = currentPlayer.chips || 0;
        }

        updateActionPanel();
    }

    // ── Cards ────────────────────────────────────────────────────
    function updateCommunityCards(cards) {
        communityCardsDiv.innerHTML = '';
        for (let i = 0; i < 5; i++) {
            const div = document.createElement('div');
            div.className = 'card';
            if (cards[i]) {
                div.textContent = cards[i].rank + cards[i].suit;
                div.classList.add(cards[i].suit === '♥' || cards[i].suit === '♦' ? 'red' : 'black');
            } else {
                div.classList.add('card-back');
            }
            communityCardsDiv.appendChild(div);
        }
    }

    function updatePlayerHand(cards) {
        playerCardsDiv.innerHTML = '';
        for (let i = 0; i < 2; i++) {
            const div = document.createElement('div');
            div.className = 'card';
            if (cards[i]) {
                div.textContent = cards[i].rank + cards[i].suit;
                div.classList.add(cards[i].suit === '♥' || cards[i].suit === '♦' ? 'red' : 'black');
            } else {
                div.classList.add('card-back');
            }
            playerCardsDiv.appendChild(div);
        }
        const myPlayer = gameState?.players?.[playerId];
        const existing = document.getElementById('myHandName');
        if (existing) existing.remove();
        if (myPlayer?.handName && !myPlayer.folded) {
            const label = document.createElement('div');
            label.id = 'myHandName';
            label.style.cssText = 'margin-top:8px;font-size:0.95em;color:#90EE90;font-weight:bold;';
            label.textContent = '🃏 ' + myPlayer.handName;
            playerCardsDiv.parentElement.appendChild(label);
        }

        // Round-winner highlight on "Your Hand" section
        const myHandSection2 = document.querySelector('.player-hand');
        if (myHandSection2) {
            const rwData = gameState?.roundWinner;
            const rwIds = rwData ? (rwData.ids || (rwData.id ? [rwData.id] : [])) : [];
            const amRoundWinner = rwIds.includes(playerId) && !!rwData;
            myHandSection2.classList.toggle('round-winner-me', !!amRoundWinner);
            document.getElementById('myRoundWinnerLabel')?.remove();
            if (amRoundWinner) {
                const rl = document.createElement('div');
                rl.id = 'myRoundWinnerLabel';
                rl.className = 'winner-inline-label';
                rl.style.marginTop = '10px';
                rl.innerHTML = rwData?.split
                    ? `🏆 WINNER <span style="font-size:0.82em;font-weight:normal;color:rgba(255,255,255,0.85);">Split Pot · $${rwData.pot || 0}</span>`
                    : `🏆 WINNER${rwData?.hand ? `<br><span style="font-size:0.82em;font-weight:normal;color:rgba(255,255,255,0.85);">${escapeHtml(rwData.hand)}</span>` : ''}`;
                myHandSection2.appendChild(rl);
            }
        }
    }

    function updatePlayers(players) {
        playersContainer.innerHTML = '';
        const winnerId = gameState?.gameWinner;
        const rw = gameState?.roundWinner;
        // roundWinner may have an 'ids' array (split pot) or just 'id'
        const roundWinnerIds = rw ? (rw.ids || (rw.id ? [rw.id] : [])) : [];
        const iAmAdmin = gameState?.adminId === playerId;

        Object.entries(players).forEach(([id, player]) => {
            // Skip own player slot, undefined/ghost players, and expired disconnected slots
            if (id === playerId) return;
            // Ghost / undefined player — clean up and skip
            if (!player || !player.name) {
                // Proactively remove ghost nodes from Firebase if we are the admin
                if (gameState?.adminId === playerId) {
                    database.ref(`games/${gameId}/players/${id}`).remove().catch(() => {});
                }
                return;
            }
            // Expired disconnect slot — skip rendering but leave in place (rejoin window logic handles it)
            if (player.leftAt && !player.isActive) return;
            const box = document.createElement('div');
            box.className = 'player-box';
            if (player.folded) box.classList.add('folded');
            if (player.sittingOut) box.classList.add('sitting-out');
            // Sitting-out status badge
            const existingBadge = box.querySelector('.player-state-badge');
            if (existingBadge) existingBadge.remove();
            if (player.sittingOut) {
                const badge = document.createElement('span');
                badge.className = 'player-state-badge badge-sitout';
                badge.textContent = '💤 Sitting Out';
                const nameEl = box.querySelector('.player-name');
                if (nameEl) nameEl.appendChild(badge);
            } else if (player.sitOutPending) {
                const badge = document.createElement('span');
                badge.className = 'player-state-badge badge-pending';
                badge.textContent = '⏳ Sitting Out Soon';
                const nameEl = box.querySelector('.player-name');
                if (nameEl) nameEl.appendChild(badge);
            } else if (player.pendingAdmit) {
                const badge = document.createElement('span');
                badge.className = 'player-state-badge badge-pending';
                badge.textContent = '⏳ Waiting Admit';
                const nameEl = box.querySelector('.player-name');
                if (nameEl) nameEl.appendChild(badge);
            } else if (player.spectating) {
                const badge = document.createElement('span');
                badge.className = 'player-state-badge badge-observer';
                badge.textContent = '👁️ Spectating';
                const nameEl = box.querySelector('.player-name');
                if (nameEl) nameEl.appendChild(badge);
            } else if (player.observer) {
                const badge = document.createElement('span');
                badge.className = 'player-state-badge badge-observer';
                badge.textContent = '👀 Watching';
                const nameEl = box.querySelector('.player-name');
                if (nameEl) nameEl.appendChild(badge);
            }
            if (gameState.status === 'playing' && isPlayerTurn(id)) box.classList.add('active');
            const isGameWinner = winnerId && winnerId === id;
            if (isGameWinner && gameState.status === 'gameover') box.classList.add('game-winner');
            // Round winner highlight — show whenever roundWinner is set (including during showdown)
            const isRoundWinner = roundWinnerIds.includes(id) && !!rw;
            if (isRoundWinner) box.classList.add('round-winner');

            const roundBet = player.bet || 0;
            let revealedHTML = '';
            if (player.revealedCards?.length > 0) {
                const cards = player.revealedCards.map(c => {
                    const col = (c.suit === '♥' || c.suit === '♦') ? 'red' : 'black';
                    return `<div class="mini-card ${col}">${c.rank}${c.suit}</div>`;
                }).join('');
                revealedHTML = `<div class="revealed-cards">${cards}</div>` +
                    (player.handName ? `<div class="hand-name">🃏 ${player.handName}</div>` : '');
            }

            const potIsEmpty = !gameState.pot || gameState.pot === 0;
            let statusBadge = '';
            if (player.sittingOut && gameState.status !== 'gameover')
                statusBadge = '<div class="status sitout-badge">💤 Sitting Out</div>';
            else if (player.observer && gameState.status !== 'gameover')
                statusBadge = '<div class="status broke-label">Observing 👀</div>';
            else if (player.loser && potIsEmpty && gameState.status !== 'gameover')
                statusBadge = '<div class="status loser-badge">Broke 💀</div>';
            else if (player.chips === 0 && !potIsEmpty && !player.folded && !player.observer)
                statusBadge = '<div class="status allin-badge">ALL IN 🔥</div>';

            const crownLabel = (isGameWinner && gameState.status === 'gameover')
                ? '<div class="crown-label">👑 CHAMPION</div>' : '';
            // Round winner banner (shows after each hand, until next hand starts)
            const roundWinnerLabel = isRoundWinner
                ? `<div class="winner-inline-label">🏆 WINNER${rw?.hand ? '<br><span style="font-size:0.82em;font-weight:normal;color:rgba(255,255,255,0.85);">' + escapeHtml(rw.hand) + '</span>' : ''}</div>`
                : '';

            // Inline promote button (admin, anytime except gameover)
            const promoteBtn = (iAmAdmin && gameState.status !== 'gameover')
                ? `<button class="inline-promote-btn" data-pid="${id}" title="Make admin">👑</button>` : '';

            // Left side of header: crown for admin, player icon for others (balanced layout)
            const isThisAdmin = (id === gameState.adminId);
            let leftIcon = '';
            if (iAmAdmin && gameState.status !== 'gameover') {
                // Admin viewing: left side has promote button, right is balanced spacer or admin crown
                leftIcon = isThisAdmin
                    ? `<span class="player-role-icon" title="Room Admin">👑</span>`
                    : `<span style="width:26px;flex-shrink:0;"></span>`; // spacer to balance promote btn
            } else {
                // Non-admin viewing: symmetric icon on each side
                leftIcon = isThisAdmin
                    ? `<span class="player-role-icon" title="Room Admin">👑</span>`
                    : `<span class="player-role-icon" title="Player">👤</span>`;
            }
            // Right side
            const rightSide = (iAmAdmin && gameState.status !== 'gameover')
                ? promoteBtn
                : (isThisAdmin
                    ? `<span style="width:26px;flex-shrink:0;"></span>`
                    : `<span class="player-role-icon" title="Player">👤</span>`);

            const isTheirTurn = gameState.status === 'playing' && isPlayerTurn(id);
            // Compute initial timer value from turnTimestamp to avoid the "--s" flash
            let theirTimerHTML = '';
            if (isTheirTurn && gameState.turnTimestamp) {
                const remSecs = Math.max(0, Math.ceil((gameState.turnTimestamp + TURN_SECONDS * 1000 - Date.now()) / 1000));
                theirTimerHTML = `<div class="player-turn-timer">⏱ ${remSecs}s</div>`;
            } else if (isTheirTurn) {
                theirTimerHTML = `<div class="player-turn-timer">⏱ --s</div>`;
            }
            box.innerHTML =
                `<div class="player-box-header">${leftIcon}<h4 style="font-size:${player.name.length > 14 ? '0.78em' : player.name.length > 10 ? '0.9em' : '1em'}">${escapeHtml(player.name)}${bumUsernames.has((player.username || player.name || '').toLowerCase()) ? '<span class="bum-rank-badge">🚮 bum</span>' : ''}</h4>${rightSide}</div>` +
                `<div class="chips">💰 $${player.chips}</div>` +
                (roundBet > 0 ? `<div class="bet">Current Bet: $${roundBet}</div>` : '') +
                (player.folded ? '<div class="status">Folded</div>' : '') +
                statusBadge + crownLabel + theirTimerHTML + revealedHTML + roundWinnerLabel;

            if (iAmAdmin && gameState.status !== 'gameover') {
                box.querySelector('.inline-promote-btn')?.addEventListener('click', e => {
                    e.stopPropagation();
                    showConfirm(`Make ${player.name} the room admin?`, '👑').then(yes => { if (yes) promotePlayer(id); });
                });
            }
            playersContainer.appendChild(box);
        });
    }

    function updateWinnerHighlight() {
        const winnerId = gameState?.gameWinner;
        const myHandSection = document.querySelector('.player-hand');
        if (!myHandSection) return;
        document.getElementById('myWinnerLabel')?.remove();
        if (winnerId === playerId && gameState.status === 'gameover') {
            myHandSection.classList.add('game-winner-me');
            const label = document.createElement('div');
            label.id = 'myWinnerLabel';
            label.className = 'crown-label';
            label.textContent = '👑 YOU ARE THE CHAMPION!';
            myHandSection.appendChild(label);
        } else {
            myHandSection.classList.remove('game-winner-me');
        }
    }

    // ── Action Panel ─────────────────────────────────────────────
    function updateActionPanel() {
        const sittingOutPanel = document.getElementById('sittingOutPanel');
        const cur = gameState.players?.[playerId];

        // While an action write is in-flight, hide the panel entirely.
        // This prevents it from re-appearing during the async Firebase round-trip.
        if (actionSubmitting) {
            actionPanel.classList.add('hidden');
            return;
        }

        // Spectators/pending-admits NEVER get the action panel or timers
        if (cur?.spectating || cur?.pendingAdmit || cur?.admittedNextHand || cur?.admittedNextHand2) {
            actionPanel.classList.add('hidden');
            if (sittingOutPanel) {
                sittingOutPanel.classList.remove('hidden');
                const reasonEl = document.getElementById('sittingOutReason');
                const wakeUpBtn = document.getElementById('wakeUpBtn');
                if (reasonEl) {
                    if (cur.pendingAdmit) {
                        reasonEl.textContent = 'You are in the spectator queue. Wait for the room admin to admit you.';
                    } else if (cur.admittedNextHand) {
                        reasonEl.textContent = "You've been admitted! Sitting out this round — you'll be dealt in next hand 🃏";
                    } else if (cur.admittedNextHand2) {
                        reasonEl.textContent = "Almost there! You'll be dealt in from the very next hand 🃏";
                    } else {
                        reasonEl.textContent = 'You are spectating this game. The admin can admit you to play.';
                    }
                }
                // Hide the "Return to Game" button for spectators — only admin can admit them
                if (wakeUpBtn) wakeUpBtn.style.display = 'none';
                const sittingOutIcon = sittingOutPanel.querySelector('div:first-child');
                if (sittingOutIcon) sittingOutIcon.textContent = cur.pendingAdmit ? '⏳' : (cur.admittedNextHand || cur.admittedNextHand2) ? '🃏' : '👁️';
                const sittingOutTitle = sittingOutPanel.querySelector('div:nth-child(2)');
                if (sittingOutTitle) sittingOutTitle.textContent = cur.pendingAdmit ? 'Waiting to be admitted' : (cur.admittedNextHand || cur.admittedNextHand2) ? 'Joining next hand…' : 'You are spectating';
            }
            stopTurnTimer();
            return;
        }
        // Restore wake-up button for non-spectators
        const wakeUpBtnEl = document.getElementById('wakeUpBtn');
        if (wakeUpBtnEl) wakeUpBtnEl.style.display = '';

        // Show sitting-out panel if player is sitting out (regardless of game status)
        if (cur?.sittingOut) {
            if (sittingOutPanel) sittingOutPanel.classList.remove('hidden');
            // Update reason text dynamically
            const reasonEl = document.getElementById('sittingOutReason');
            if (reasonEl) {
                if (cur.sitOutReason === 'timeout') {
                    reasonEl.textContent = 'You were sat out after 2 consecutive timeouts. Click below to rejoin next hand.';
                } else {
                    reasonEl.textContent = 'You are sitting out. Click below to rejoin from the next hand.';
                }
            }
            actionPanel.classList.add('hidden');
            stopTurnTimer();
            return;
        }
        if (sittingOutPanel) sittingOutPanel.classList.add('hidden');

        // Action panel only shows during an active game on your turn
        if (gameState.status !== 'playing') {
            actionPanel.classList.add('hidden');
            stopTurnTimer();
            return;
        }
        if (!cur || cur.folded || cur.chips === 0) {
            actionPanel.classList.add('hidden');
            stopTurnTimer();
            return;
        }

        if (isMyTurn()) {
            actionPanel.classList.remove('hidden');
            updateSitOutBtn();
            const ts = gameState.turnTimestamp;
            // Always show the action panel buttons even if turnTimestamp hasn't arrived yet
            // (Firebase multi-key updates can be delivered in two snapshots on some clients,
            //  meaning currentTurnPlayerId arrives before turnTimestamp — don't hide the panel).
            if (ts && ts !== lastTurnTimestamp) {
                const isNewTurn = true;
                lastTurnTimestamp = ts;
                autoActInProgress = false; // reset for this fresh turn
                startTurnTimer(ts);
                startPlayerTimerTick(ts);
                // Reset slider to minimum (BIG_BLIND = $20) only on a genuinely new turn
                if (isNewTurn) {
                    const currentBetNow = gameState.currentBet || 0;
                    const myBetNow      = (gameState.players[playerId]?.bet) || 0;
                    const availChipsNow = gameState.players[playerId]?.chips || 0;
                    const sliderMin = Math.ceil(Math.max(currentBetNow + BIG_BLIND, BIG_BLIND) / 5) * 5;
                    const sliderMax = Math.max(sliderMin, myBetNow + availChipsNow);
                    betSlider.min   = sliderMin;
                    betSlider.max   = sliderMax;
                    betSlider.step  = 5;
                    betSlider.value = sliderMin;
                    if (betInput) { betInput.min = sliderMin; betInput.max = sliderMax; betInput.value = sliderMin; betInput.disabled = false; }
                    updateBetAmount();
                }
            }
            const currentBet   = gameState.currentBet || 0;
            const myBet        = cur.bet || 0;
            const callAmount   = Math.max(0, currentBet - myBet);
            const availChips   = cur.chips;
            const anyoneAllIn  = Object.values(gameState.players).some(p => !p.folded && p.chips === 0);

            if (anyoneAllIn && callAmount > 0) {
                document.getElementById('callAmount').textContent = Math.min(callAmount, availChips);
                callBtn.disabled = false;
                checkBtn.disabled = raiseBtn.disabled = betSlider.disabled = true; if(betInput) betInput.disabled = true;
                betAmount.textContent = '$0';
            } else if (callAmount > 0) {
                document.getElementById('callAmount').textContent = callAmount;
                callBtn.disabled = availChips <= 0;
                checkBtn.disabled = true;
                const canRaise = availChips > callAmount;
                raiseBtn.disabled = betSlider.disabled = !canRaise; if(betInput) betInput.disabled = !canRaise;
                if (canRaise) {
                    const newMin = currentBet + BIG_BLIND;
                    const newMax = myBet + availChips;
                    // Only reset slider if min/max changed significantly to avoid jump bug
                    if (parseInt(betSlider.min) !== newMin || parseInt(betSlider.max) !== newMax) {
                        betSlider.min = newMin;
                        betSlider.max = newMax;
                        betSlider.step = 5;
                        const clamped = Math.max(newMin, Math.min(parseInt(betSlider.value) || newMin, newMax));
                        betSlider.value = clamped;
                    }
                    updateBetAmount();
                }
            } else {
                document.getElementById('callAmount').textContent = 0;
                callBtn.disabled = true;
                checkBtn.disabled = false;
                const canRaise = availChips > 0;
                raiseBtn.disabled = betSlider.disabled = !canRaise; if(betInput) betInput.disabled = !canRaise;
                if (canRaise) {
                    const newMin = currentBet + BIG_BLIND;
                    const newMax = myBet + availChips;
                    if (parseInt(betSlider.min) !== newMin || parseInt(betSlider.max) !== newMax) {
                        betSlider.min = newMin;
                        betSlider.max = newMax;
                        betSlider.step = 5;
                        const clamped = Math.max(newMin, Math.min(parseInt(betSlider.value) || newMin, newMax));
                        betSlider.value = clamped;
                    }
                    updateBetAmount();
                }
            }
        } else {
            actionPanel.classList.add('hidden');
            // Update sit-out button state (e.g. cancel pending) even when action panel is hidden
            updateSitOutBtn();
            // Only stop MY turn timer bar — don't kill playerTimerInterval (that tracks the other player's countdown)
            if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
            const wrap = document.getElementById('turnTimerWrap');
            if (wrap) wrap.classList.add('hidden');
            // Keep the other-player countdown labels ticking when it's not my turn.
            // Use lastPlayerTimerTs (NOT lastTurnTimestamp) so we never poison the
            // new-turn detection that startTurnTimer relies on.
            if (gameState.status === 'playing' && gameState.turnTimestamp) {
                const ts = gameState.turnTimestamp;
                if (ts !== lastPlayerTimerTs || !playerTimerInterval) {
                    lastPlayerTimerTs = ts;
                    startPlayerTimerTick(ts);
                }
            } else if (gameState.status !== 'playing') {
                // Not playing — clear everything
                if (playerTimerInterval) { clearInterval(playerTimerInterval); playerTimerInterval = null; }
                lastPlayerTimerTs = 0;
            }
        }
    }

    function isMyTurn()             { return gameState?.currentTurnPlayerId === playerId; }
    function isPlayerTurn(id)       { return gameState?.currentTurnPlayerId === id; }
    function updateBetAmount()      {
        const v = snapToStep5(parseInt(betSlider.value)||0, parseInt(betSlider.min)||0, parseInt(betSlider.max)||0);
        betSlider.value = v;
        if (betInput) { betInput.value = v; betInput.min = betSlider.min; betInput.max = betSlider.max; }
    }

    // ── Turn Timer ───────────────────────────────────────────────
    function stopTurnTimer(resetTs = false) {
        if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
        if (playerTimerInterval) { clearInterval(playerTimerInterval); playerTimerInterval = null; }
        const bar = document.getElementById('turnTimerBar');
        const wrap = document.getElementById('turnTimerWrap');
        if (wrap) wrap.classList.add('hidden');
        if (bar) { bar.style.width = '100%'; bar.style.background = 'linear-gradient(90deg, #4CAF50, #8BC34A)'; }
        // Always reset the cached timestamps so the next updateActionPanel always re-evaluates cleanly
        lastTurnTimestamp = 0;
        lastPlayerTimerTs = 0;
    }

    function startPlayerTimerTick(turnTs) {
        // Refresh every 250ms so the countdown labels on other-player boxes update smoothly.
        // We capture turnTs at call time to avoid stale-closure timing bugs.
        if (playerTimerInterval) clearInterval(playerTimerInterval);
        const deadline = turnTs + TURN_SECONDS * 1000;
        function tickOtherTimer() {
            const rem = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            // Re-query every tick so newly-rendered DOM elements are always found
            // (fixes freeze when updateUI re-creates player boxes mid-countdown)
            document.querySelectorAll('.player-turn-timer').forEach(el => {
                el.textContent = `⏱ ${rem}s`;
            });
            // Don't stop early — let updateUI / stopTurnTimer clear this interval.
            // Stopping here caused the "frozen" timer: new DOM nodes were created after
            // the interval died, leaving stale text with no updater running.
        }
        // Tick immediately so there's no blank "⏱ --s" flash, then continue every 250ms
        tickOtherTimer();
        playerTimerInterval = setInterval(tickOtherTimer, 250);
    }

    function startTurnTimer(turnTs) {
        // Only clear the MY-turn timer bar, not the playerTimerInterval (other-player tick)
        if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
        const wrap = document.getElementById('turnTimerWrap');
        const bar  = document.getElementById('turnTimerBar');
        // If the deadline has already passed (stale turnTs re-delivered by Firebase), do NOT
        // create a new timer — it would fire autoActOnTimeout a second time immediately.
        // Allow 5s of server/client clock skew before treating the turn as expired.
        if (turnTs + TURN_SECONDS * 1000 + 5000 <= Date.now()) return;
        const label = document.getElementById('turnTimerLabel');
        if (!wrap || !bar) return;
        wrap.classList.remove('hidden');

        const deadline = turnTs + TURN_SECONDS * 1000;
        let firedTimeout = false; // guard: autoActOnTimeout fires at most once per timer

        function tick() {
            const remaining = Math.max(0, deadline - Date.now());
            const pct = (remaining / (TURN_SECONDS * 1000)) * 100;
            bar.style.width = pct + '%';
            if (pct > 50) {
                bar.style.background = 'linear-gradient(90deg, #4CAF50, #8BC34A)';
            } else if (pct > 25) {
                bar.style.background = 'linear-gradient(90deg, #FF9800, #FFC107)';
            } else {
                bar.style.background = 'linear-gradient(90deg, #f44336, #FF5722)';
            }
            if (label) label.textContent = Math.ceil(remaining / 1000) + 's';

            if (remaining <= 0 && !firedTimeout) {
                firedTimeout = true;
                // Stop the interval BEFORE calling autoActOnTimeout to prevent re-entry
                if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
                if (wrap) wrap.classList.add('hidden');
                autoActOnTimeout();
            }
        }

        tick();
        turnTimerInterval = setInterval(tick, 250);
    }

    async function autoActOnTimeout() {
        // Guard against concurrent calls (e.g. interval fires multiple times before clearing)
        if (autoActInProgress) return;
        // Also bail if a manual action is already in-flight — playerAction's mutex would
        // silently drop the autoAct call, leaving the turn stuck. Instead, defer by 500ms
        // and let the in-flight action finish first.
        if (actionSubmitting) {
            setTimeout(autoActOnTimeout, 500);
            return;
        }
        autoActInProgress = true;
        try {
        // Only the player whose turn it is should auto-act
        if (!isMyTurn() || !gameId || !playerId) { autoActInProgress = false; return; }
        // Race guard: re-read fresh state and check lastActedTs before acting
        const raceCheckSnap = await database.ref(`games/${gameId}`).once('value');
        const raceState = raceCheckSnap.val();
        if (!raceState || raceState.currentTurnPlayerId !== playerId) { autoActInProgress = false; return; }
        const raceMe = raceState.players?.[playerId];
        if (raceMe?.lastActedTs && raceState.turnTimestamp && raceMe.lastActedTs >= raceState.turnTimestamp) {
            // Player already acted — timer fired too late, skip
            console.warn('[TIMEOUT GUARD] Manual action already recorded, skipping auto-act');
            autoActInProgress = false; return;
        }
        const cur = gameState?.players?.[playerId];
        if (!cur || cur.folded || cur.spectating || cur.pendingAdmit) { autoActInProgress = false; return; }

        const currentBet = gameState.currentBet || 0;
        const myBet = cur.bet || 0;
        const callAmount = currentBet - myBet;

        // Either way — increment the consecutive timeout counter.
        // Both check and fold timeouts count toward the 2-strike sit-out rule.
        const freshSnap = await database.ref(`games/${gameId}/players/${playerId}/timeoutFolds`).once('value');
        const prevCount = freshSnap.val() || 0;
        const newCount  = prevCount + 1;

        if (newCount >= 2) {
            // 2 consecutive timeouts (check or fold) — sit the player out immediately
            await database.ref(`games/${gameId}/players/${playerId}`).update({
                sittingOut:    true,
                sitOutPending: false,
                timeoutFolds:  0,
                sitOutReason:  'timeout'
            });
            isSittingOutPending = false;
            addLog(`💤 ${playerName} has been sat out after 2 consecutive timeouts. Click "Return to Game" to rejoin.`);
            // Always fold when sitting out — don't leave them in the hand
            await playerAction('fold', true);
        } else {
            await database.ref(`games/${gameId}/players/${playerId}/timeoutFolds`).set(newCount);
            if (callAmount > 0) {
                addLog(`⏱️ ${playerName} timed out and folded. (${newCount}/2 timeouts)`);
                await playerAction('fold', true);
            } else {
                addLog(`⏱️ ${playerName} timed out and checked. (${newCount}/2 timeouts)`);
                await playerAction('check', true);
            }
        }
        } catch(e) { console.error('autoActOnTimeout error:', e); }
        finally { autoActInProgress = false; }
    }
    function getActivePlayerIds()   {
        return Object.keys(gameState.players).filter(id => !gameState.players[id].folded && gameState.players[id].chips > 0 && !gameState.players[id].spectating && !gameState.players[id].pendingAdmit && !gameState.players[id].observer);
    }
    function getNextTurnPlayerId(afterId, players) {
        const all = Object.keys(players);
        const si  = all.indexOf(afterId);
        for (let i = 1; i <= all.length; i++) {
            const nid = all[(si + i) % all.length];
            const p   = players[nid];
            // Skip spectators, pending-admits, observers, sitting-out, folded, or chipless
            if (!p.folded && p.chips > 0 && !p.sittingOut && !p.spectating && !p.pendingAdmit && !p.observer && !p.admittedNextHand && !p.admittedNextHand2) return nid;
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    //  PLAYER ACTION
    // ═══════════════════════════════════════════════════════════════
    async function playerAction(action, fromTimeout = false) {
        if (!isMyTurn()) return;
        // Mutex guard — only one playerAction may be in-flight at a time.
        // Without this, a manual click and autoActOnTimeout can both enter
        // simultaneously, both pass the lastActedTs guard, and both write —
        // causing the action panel to flash and the action to not register.
        if (actionSubmitting) return;

        // FIX 2: Do NOT stop the timer before the async Firebase guard checks pass.
        // If stopTurnTimer() runs here and a guard (e.g. freshState.currentTurnPlayerId !== playerId)
        // causes an early return, the timer is permanently killed. lastTurnTimestamp is reset to 0
        // by stopTurnTimer, so when updateActionPanel() re-runs in finally, it sees a different ts
        // and tries to start a new timer -- but TURN_SECONDS may already have elapsed, so the guard
        // inside startTurnTimer() silently skips it. Player is stuck with panel but no countdown.
        // Instead: stop the timer only AFTER all guards pass (see below before the switch statement).

        // Hide action panel immediately for the duration of the Firebase write.
        // This prevents the panel from flickering back into view during the async round-trip.
        actionSubmitting = true;
        actionPanel.classList.add('hidden');

        // Snapshot the raise amount synchronously RIGHT NOW before any async work.
        // If we read betInput/betSlider after the async Firebase read, the DOM values
        // may have changed (slider input event fires after click, or user keeps dragging)
        // causing the raise to use a stale amount and incorrectly fail the total<=currentBet guard.
        const raiseTotalSnapshot = action === 'raise'
            ? (() => {
                const min = parseInt(betSlider.min)||0, max = parseInt(betSlider.max)||0;
                const raw = parseInt(betInput?.value ?? betSlider.value);
                return isNaN(raw) ? min : snapToStep5(raw, min, max);
            })()
            : null;

        // Track whether we completed the full write — only early-abort paths need
        // updateActionPanel() in finally (to re-show for the next player's turn).
        // A completed write patches gameState optimistically, so the Firebase listener
        // will handle showing the panel when the real update arrives.
        let actionCommitted = false;

        try {

        // Manual actions always reset the consecutive timeout fold streak in Firebase.
        // We write unconditionally (don't check local gameState.timeoutFolds) to avoid
        // a race condition where the local state hasn't yet received the Firebase update
        // from a prior timeout fold write — causing the reset to be silently skipped.
        if (!fromTimeout) {
            await database.ref(`games/${gameId}/players/${playerId}/timeoutFolds`).set(0);
        }

        // ── Read FRESH state from Firebase to avoid stale-gameState money bugs ──
        const freshSnap  = await database.ref(`games/${gameId}`).once('value');
        const freshState = freshSnap.val();
        if (!freshState) return;
        // Re-validate turn ownership with fresh state
        if (freshState.currentTurnPlayerId !== playerId) return;
        // Anti-double-act guard: if we already recorded an action since the current
        // turnTimestamp, abort. This prevents the timer race where autoActOnTimeout
        // fires in the same tick as a manual action.
        const myPlayer = freshState.players?.[playerId];
        if (myPlayer?.lastActedTs && freshState.turnTimestamp &&
            myPlayer.lastActedTs >= freshState.turnTimestamp) {
            console.warn('[ACTION GUARD] Duplicate action blocked for', playerId);
            return;
        }

        // FIX 2 (cont): Guards passed — now safe to stop the timer.
        // At this point we know the action is valid and will commit.
        stopTurnTimer();

        const updates      = {};
        const cur          = freshState.players[playerId];
        if (!cur) return;
        const currentBet   = freshState.currentBet || 0;
        const myBet        = cur.bet || 0;

        switch (action) {
            case 'fold':
                if (cur.folded) return;
                updates[`games/${gameId}/players/${playerId}/folded`] = true;
                if (!fromTimeout) addLog(`${playerName} folded`);
                // If sit-out was pending, apply it immediately on fold
                if (cur.sitOutPending || isSittingOutPending) {
                    updates[`games/${gameId}/players/${playerId}/sittingOut`] = true;
                    updates[`games/${gameId}/players/${playerId}/sitOutPending`] = false;
                    isSittingOutPending = false;
                    addLog(`💤 ${playerName} is now sitting out.`);
                }
                const remaining = Object.keys(freshState.players).filter(id =>
                    id !== playerId && !freshState.players[id].folded && !freshState.players[id].spectating && !freshState.players[id].pendingAdmit && !freshState.players[id].observer);
                if (remaining.length === 1) {
                    // Last player standing — null out the turn immediately so the timer stops
                    updates[`games/${gameId}/currentTurnPlayerId`] = null;
                    updates[`games/${gameId}/turnTimestamp`]       = null;
                    updates[`games/${gameId}/players/${playerId}/lastActedTs`] = Date.now();
                    await database.ref().update(updates);
                    if (gameState) { gameState.currentTurnPlayerId = null; gameState.turnTimestamp = null; }
                    actionCommitted = true;
                    setTimeout(() => awardPotToPlayer(remaining[0]), 1000);
                    return;
                }
                break;

            case 'check':
                if (currentBet > myBet) return;
                addLog(`${playerName} checked`);
                break;

            case 'call': {
                const callAmt  = currentBet - myBet;
                if (callAmt > 0) {
                    const actual = Math.min(callAmt, cur.chips);
                    updates[`games/${gameId}/players/${playerId}/chips`] = cur.chips - actual;
                    updates[`games/${gameId}/players/${playerId}/bet`]   = myBet + actual;
                    updates[`games/${gameId}/pot`] = (freshState.pot || 0) + actual;
                    addLog(`${playerName} called ${actual < callAmt ? 'all-in ' : ''}$${actual}`);
                }
                break;
            }

            case 'raise': {
                // Use the pre-snapshotted value captured synchronously at click time.
                // Reading betInput/betSlider here (after async Firebase read) is unsafe —
                // the slider's input events or further dragging can change the DOM value
                // in the ~500ms gap, causing the raise to submit the wrong amount or
                // spuriously fail the total<=currentBet guard and abort with no commit.
                const total = raiseTotalSnapshot;
                // Sync the box back so it shows the actual submitted value
                if (betInput) betInput.value = total;
                betSlider.value = total;
                if (total <= currentBet) return;
                const toAdd   = total - myBet;
                const actual  = Math.min(toAdd, cur.chips);
                const newTotal = myBet + actual;
                updates[`games/${gameId}/players/${playerId}/chips`] = cur.chips - actual;
                updates[`games/${gameId}/players/${playerId}/bet`]   = newTotal;
                updates[`games/${gameId}/pot`]                        = (freshState.pot || 0) + actual;
                updates[`games/${gameId}/currentBet`]                 = newTotal;
                const chipsAfter = cur.chips - actual;
                const newActed   = {};
                Object.keys(freshState.players).forEach(id => {
                    const p = freshState.players[id];
                    if (!p.folded) {
                        const chips = id === playerId ? chipsAfter : p.chips;
                        if (chips > 0) newActed[id] = id === playerId;
                    }
                });
                updates[`games/${gameId}/playersActed`] = newActed;
                addLog(chipsAfter === 0
                    ? `${playerName} goes ALL-IN for $${newTotal}!`
                    : `${playerName} raised to $${newTotal}`);
                break;
            }
        }

        if (action !== 'raise') {
            const acted = { ...(freshState.playersActed || {}) };
            acted[playerId] = true;
            updates[`games/${gameId}/playersActed`] = acted;
        }

        const updPlayers = JSON.parse(JSON.stringify(freshState.players));
        if (updates[`games/${gameId}/players/${playerId}/chips`] !== undefined)
            updPlayers[playerId].chips = updates[`games/${gameId}/players/${playerId}/chips`];
        if (updates[`games/${gameId}/players/${playerId}/folded`] !== undefined)
            updPlayers[playerId].folded = updates[`games/${gameId}/players/${playerId}/folded`];
        if (updates[`games/${gameId}/players/${playerId}/bet`] !== undefined)
            updPlayers[playerId].bet = updates[`games/${gameId}/players/${playerId}/bet`];

        // Determine the acted map after this action
        const finalActed = updates[`games/${gameId}/playersActed`] || {};

        // Check if the betting round will be complete after this action so we can
        // null out currentTurnPlayerId immediately — preventing the 1-second window
        // where the next player briefly gets the action panel before showdown.
        const activePlayers  = Object.entries(updPlayers).filter(([, p]) => !p.folded && !p.spectating && !p.pendingAdmit && !p.observer);
        const actingPlayers  = activePlayers.filter(([, p]) => p.chips > 0);
        const updCurrentBet  = updates[`games/${gameId}/currentBet`] ?? (freshState.currentBet || 0);
        const allActed       = actingPlayers.length > 0 && actingPlayers.every(([id]) => finalActed[id] === true);
        const allBetsMatched = activePlayers.every(([, p]) => (p.bet || 0) >= updCurrentBet || p.chips === 0);
        const roundComplete  = activePlayers.length <= 1 || (allActed && allBetsMatched);

        let nextId;
        if (roundComplete) {
            // Betting done — null out turn so no one gets an action panel during showdown delay
            nextId = null;
        } else {
            nextId = getNextTurnPlayerId(playerId, updPlayers);
        }

        updates[`games/${gameId}/currentTurnPlayerId`] = nextId;
        updates[`games/${gameId}/currentPlayerIndex`]  = 0;
        updates[`games/${gameId}/lastActivity`] = Date.now();
        updates[`games/${gameId}/turnTimestamp`] = Date.now();
        // Stamp action time — prevents autoActOnTimeout racing with manual actions
        updates[`games/${gameId}/players/${playerId}/lastActedTs`] = Date.now();

        await database.ref().update(updates);
        // Optimistically patch local gameState so updateActionPanel immediately knows the
        // turn has moved — avoids the brief re-flash where the panel shows on the actor
        // before Firebase propagating the new currentTurnPlayerId to the listener.
        if (gameState) {
            gameState.currentTurnPlayerId = nextId;
            gameState.turnTimestamp = nextId ? updates[`games/${gameId}/turnTimestamp`] : null;
        }
        actionCommitted = true;
        // Only the player who just acted advances the round — prevents other clients'
        // checkBettingRoundComplete from racing and causing action panel flickers.
        setTimeout(() => checkBettingRoundComplete(true), 2500);
        } finally {
            actionSubmitting = false;
            if (!actionCommitted) {
                // Action was aborted (guard failed, no write) — force a re-render so the
                // panel re-shows correctly for whatever the current turn state is.
                updateActionPanel();
            }
            // If actionCommitted, the optimistic patch + Firebase listener handles UI.
            // Calling updateActionPanel() here after a successful write causes the flash:
            // the panel briefly re-appears before Firebase confirms the turn moved.
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  BETTING ROUND LOGIC
    // ═══════════════════════════════════════════════════════════════
    async function checkBettingRoundComplete(iAmTheActor = false) {
        const snap  = await database.ref(`games/${gameId}`).once('value');
        const state = snap.val();
        if (!state || state.status !== 'playing') return;

        const players       = state.players;
        const activePlayers = Object.entries(players).filter(([, p]) => !p.folded && !p.leftAt && !p.spectating && !p.pendingAdmit && !p.observer);
        const actingPlayers = activePlayers.filter(([, p]) => p.chips > 0 && !p.sittingOut && !p.spectating && !p.pendingAdmit && !p.observer);

        if (activePlayers.length <= 1) {
            if (iAmTheActor && activePlayers.length === 1) await awardPotToPlayer(activePlayers[0][0]);
            return;
        }
        if (actingPlayers.length === 0) { if (iAmTheActor) await runOutAllCards(state); return; }

        const playersActed = state.playersActed || {};
        const allActed     = actingPlayers.every(([id]) => playersActed[id] === true);

        const currentBet     = state.currentBet || 0;
        const allBetsMatched = activePlayers.every(([, p]) => (p.bet || 0) >= currentBet || p.chips === 0);

        if (!allActed || !allBetsMatched) {
            // Betting round NOT complete. Only the actor does deadlock recovery to avoid
            // multiple clients all writing currentTurnPlayerId simultaneously (causes flicker).
            if (!iAmTheActor) return;
            const currentTid = state.currentTurnPlayerId;
            // CRITICAL: if currentTurnPlayerId is null, the round just completed and
            // advanceRound() is about to fire. DO NOT reassign — that would hand the
            // turn to a player mid-transition and cause stale-turn watchdog misfires.
            if (!currentTid) return;
            const isValidTurn = currentTid && players[currentTid] && !players[currentTid].folded && players[currentTid].chips > 0;
            if (!isValidTurn && actingPlayers.length > 0) {
                // Find who hasn't acted yet and give them the turn
                const needToAct = actingPlayers.find(([id]) => !playersActed[id]);
                const nextId = needToAct ? needToAct[0] : actingPlayers[0][0];
                console.warn('[DEADLOCK RECOVERY] Assigning stalled turn to:', nextId);
                await database.ref(`games/${gameId}`).update({
                    currentTurnPlayerId: nextId,
                    turnTimestamp: Date.now()
                });
            }
            return;
        }

        const nowActing = activePlayers.filter(([, p]) => p.chips > 0);
        if (nowActing.length === 0) { if (iAmTheActor) await runOutAllCards(state); return; }

        if (iAmTheActor) advanceRound();
    }

    async function runOutAllCards(state) {
        let round  = state.round;
        const deck = state.deck;
        let di     = state.deckIndex || 0;
        let cc     = [...(state.communityCards || [])];
        const upd  = {};

        if (round === 'preflop') { cc.push(deck[di], deck[di+1], deck[di+2]); di += 3; round = 'flop'; }
        if (round === 'flop')    { cc.push(deck[di]); di++; round = 'turn'; }
        if (round === 'turn')    { cc.push(deck[di]); di++; }

        upd[`games/${gameId}/communityCards`]       = cc;
        upd[`games/${gameId}/deckIndex`]            = di;
        upd[`games/${gameId}/round`]                = 'river';
        upd[`games/${gameId}/currentBet`]           = 0;
        upd[`games/${gameId}/currentTurnPlayerId`]  = null;
        upd[`games/${gameId}/turnTimestamp`]         = null;

        const activePlayers = Object.entries(state.players).filter(([, p]) => !p.folded && !p.spectating && !p.pendingAdmit && !p.observer);
        for (const [id, p] of activePlayers) {
            if (p.cards?.length > 0) upd[`games/${gameId}/players/${id}/revealedCards`] = p.cards;
        }

        await database.ref().update(upd);
        addLog('All players are all-in! Running it out...');
        await new Promise(r => setTimeout(r, 2500));
        await showdown();
    }

    async function advanceRound() {
        const snap  = await database.ref(`games/${gameId}`).once('value');
        const state = snap.val();
        if (!state) return;

        const rounds = ['preflop','flop','turn','river','showdown'];
        const currentRound = state.round;
        const next   = rounds[rounds.indexOf(currentRound) + 1];
        if (!next || next === 'showdown') {
            // Pause so players can see the final board state before cards are revealed
            await new Promise(r => setTimeout(r, 1500));
            await showdown();
            return;
        }

        const upd     = {};
        const players = state.players;
        upd[`games/${gameId}/round`]      = next;
        upd[`games/${gameId}/currentBet`] = 0;

        Object.keys(players).forEach(id => {
            if (!players[id].folded) upd[`games/${gameId}/players/${id}/bet`] = 0;
        });

        const acted = {};
        Object.keys(players).forEach(id => {
            if (!players[id].folded && players[id].chips > 0 && !players[id].spectating && !players[id].pendingAdmit && !players[id].observer) acted[id] = false;
        });
        upd[`games/${gameId}/playersActed`] = acted;

        // Find first active player after dealer position for proper positional play
        const activePids = Object.keys(players).filter(id => !players[id].folded && players[id].chips > 0 && !players[id].sittingOut && !players[id].spectating && !players[id].pendingAdmit && !players[id].observer && !players[id].admittedNextHand && !players[id].admittedNextHand2);
        const dealerIdx  = state.dealerIndex || 0;
        const allPids    = Object.keys(players);
        let firstId = null;
        if (activePids.length > 0) {
            // Start from player after dealer
            for (let i = 1; i <= allPids.length; i++) {
                const candidate = allPids[(dealerIdx + i) % allPids.length];
                if (activePids.includes(candidate)) { firstId = candidate; break; }
            }
            if (!firstId) firstId = activePids[0]; // fallback
        }
        upd[`games/${gameId}/currentTurnPlayerId`] = firstId;
        upd[`games/${gameId}/currentPlayerIndex`]  = 0;
        upd[`games/${gameId}/turnTimestamp`] = Date.now();

        const deck  = state.deck;
        let di      = state.deckIndex || 0;
        const cc    = [...(state.communityCards || [])];

        if (next === 'flop')  { cc.push(deck[di], deck[di+1], deck[di+2]); di += 3; }
        else if (next === 'turn' || next === 'river') { cc.push(deck[di]); di++; }

        upd[`games/${gameId}/communityCards`] = cc;
        upd[`games/${gameId}/deckIndex`]      = di;
        upd[`games/${gameId}/lastActivity`]   = Date.now();

        // FIX 4: Use a transaction as a LOCK ONLY — do NOT let it write the round value.
        // The previous implementation wrote `round` via the transaction and then wrote all
        // other fields (communityCards, currentTurnPlayerId, etc.) in a separate update().
        // Between those two async calls, other clients could read `round='river'` before the
        // river card or currentTurnPlayerId were written, causing them to see a half-advanced
        // state and call advanceRound() again — jumping straight to showdown.
        //
        // Fix: use the transaction only to claim the lock (abort if round already changed),
        // then include `round: next` IN the same multi-path upd write so everything
        // lands atomically in a single Firebase update.
        const roundRef = database.ref(`games/${gameId}/round`);
        let lockWon = false;
        await roundRef.transaction(current => {
            if (current === currentRound) { lockWon = true; return current; } // keep same value — just claim the lock
            return undefined; // abort — another instance already advanced this round
        });
        if (!lockWon) {
            console.warn(`[ADVANCE] Round already advanced from ${currentRound}, skipping.`);
            return;
        }

        // Include round in the multi-path update so round value + all board state
        // (communityCards, currentTurnPlayerId, playersActed, etc.) land atomically.
        // This closes the race window where a client sees the new round but old board state.
        upd[`games/${gameId}/round`] = next;
        await database.ref().update(upd);
        addLog(`Round: ${next.toUpperCase()}`);
    }

    async function showdown() {
        // Use a Firebase transaction on the pot to ensure only ONE client performs the showdown.
        // If another client already zeroed the pot (ran showdown), skip entirely.
        const potRef = database.ref(`games/${gameId}/pot`);
        let claimedPot = 0;
        try {
            const txResult = await potRef.transaction(currentPot => {
                if (!currentPot || currentPot <= 0) return; // abort — pot already claimed
                claimedPot = currentPot;
                return 0; // zero out the pot atomically
            });
            if (!txResult.committed || claimedPot <= 0) {
                console.warn('[SHOWDOWN] Pot already claimed by another client — skipping.');
                return;
            }
        } catch(e) {
            console.error('[SHOWDOWN] Transaction failed:', e);
            return;
        }

        // Immediately clear the active turn so no player gets an action panel during showdown.
        // Also null turnTimestamp so the watchdog can't fire on a stale timestamp.
        if (gameId) await database.ref(`games/${gameId}`).update({ currentTurnPlayerId: null, turnTimestamp: null });

        const snap  = await database.ref(`games/${gameId}`).once('value');
        const state = snap.val();
        if (!state) return;

        const players    = state.players;
        const cc         = state.communityCards || [];
        const active     = Object.entries(players).filter(([, p]) => !p.folded && !p.spectating && !p.pendingAdmit && !p.observer);

        if (active.length === 1) {
            // Award the already-claimed pot directly (awardPotToPlayer re-checks pot, so restore it first)
            const winner = state.players[active[0][0]];
            if (winner) {
                await database.ref(`games/${gameId}`).update({
                    [`players/${active[0][0]}/chips`]: winner.chips + claimedPot,
                    pot: 0
                });
                addLog(`🏆 ${winner.name} wins the round and takes $${claimedPot}!`);
                await database.ref(`games/${gameId}/roundWinner`).set({ id: active[0][0], name: winner.name, pot: claimedPot, setAt: Date.now() });
                setTimeout(() => resetGame(), 3000);
            }
            return;
        }

        const revUpd  = {};
        let bestVal   = -1;
        let winners   = [];

        for (const [id, p] of active) {
            const hand = evaluateHand([...p.cards, ...cc]);
            revUpd[`games/${gameId}/players/${id}/revealedCards`] = p.cards;
            revUpd[`games/${gameId}/players/${id}/handName`]      = hand.name;
            addLog(`${p.name} shows: ${hand.name}`);
            if (hand.value > bestVal) { bestVal = hand.value; winners = [id]; }
            else if (hand.value === bestVal) winners.push(id);
        }

        await database.ref().update(revUpd);
        await new Promise(r => setTimeout(r, 2000));

        // Use claimedPot (already zeroed in Firebase) so chips are correct
        const potShare = Math.floor(claimedPot / winners.length);
        const winUpd   = {};
        for (const wid of winners) {
            const w = players[wid];
            winUpd[`games/${gameId}/players/${wid}/chips`] = w.chips + potShare;
            addLog(`🏆 ${w.name} wins $${potShare}!`);
            // Pass winner's username so recordRoundWon never needs to look up gameState
            recordRoundWon(w.username || w.name).catch(() => {});
        }
        await database.ref().update(winUpd);

        // Compute names/hand for roundWinner metadata
        const winnerNames = winners.map(wid => players[wid]?.name || 'Unknown').join(' & ');
        const handDesc = winners.length > 0 ? (evaluateHand([...players[winners[0]].cards, ...cc]).name) : '';

        // Mark round winner(s) on game state so the UI can highlight their cards
        await database.ref(`games/${gameId}/roundWinner`).set({
            id: winners[0],          // primary winner id (for "me" check)
            ids: winners,            // all winner ids (for split pot highlighting)
            name: winnerNames,
            pot: claimedPot,
            hand: handDesc,
            split: winners.length > 1,
            setAt: Date.now()
        });

        const afterSnap  = await database.ref(`games/${gameId}/players`).once('value');
        const afterPlayers = afterSnap.val() || {};
        const loserUpd   = {};
        for (const [id, p] of Object.entries(afterPlayers)) {
            if (p.chips === 0 && !p.folded) loserUpd[`games/${gameId}/players/${id}/loser`] = true;
        }
        if (Object.keys(loserUpd).length) await database.ref().update(loserUpd);

        setTimeout(() => resetGame(), 5000);
    }

    async function awardPotToPlayer(winnerId) {
        const snap  = await database.ref(`games/${gameId}`).once('value');
        const state = snap.val();
        if (!state) return;
        const pot = state.pot || 0;
        // Guard: if pot is 0 or already cleared, don't award again (prevents infinite money glitch)
        if (pot <= 0) {
            setTimeout(() => resetGame(), 3000);
            return;
        }
        // Guard: if game is not in playing state, don't award
        if (state.status !== 'playing') return;
        const winner = state.players[winnerId];
        if (!winner) return;

        const winnerNewChips = winner.chips + pot;
        // Atomic update: award chips and clear pot in one write to prevent double-award
        await database.ref(`games/${gameId}`).update({
            [`players/${winnerId}/chips`]: winnerNewChips,
            pot: 0
        });
        addLog(`🏆 ${winner.name} wins the round and takes $${pot}!`);
        // Pass winner's username so recordRoundWon never needs to look up gameState
        recordRoundWon(winner.username || winner.name).catch(() => {});

        // Check immediately if this makes someone the overall champion — don't wait for resetGame
        const playersAfter = state.players;
        const updatedChips = { ...playersAfter };
        if (updatedChips[winnerId]) updatedChips[winnerId] = { ...updatedChips[winnerId], chips: winnerNewChips };
        const trueWithChips = Object.entries(updatedChips).filter(([, p]) =>
            p.chips > 0 && !p.spectating && !p.pendingAdmit && !p.admittedNextHand && !p.admittedNextHand2 && !p.leftAt
        );
        const trueActive = trueWithChips.filter(([, p]) => !p.sittingOut);
        if (trueWithChips.length === 1 || (trueWithChips.length > 1 && trueActive.length <= 1)) {
            await database.ref(`games/${gameId}`).update({ gameWinner: winnerId, status: 'gameover' });
        }

        // Mark round winner on game state temporarily so UI can show it
        await database.ref(`games/${gameId}/roundWinner`).set({ id: winnerId, name: winner.name, pot, setAt: Date.now() });
        setTimeout(() => resetGame(), 3000);
    }

    // ═══════════════════════════════════════════════════════════════
    //  HAND EVALUATION
    // ═══════════════════════════════════════════════════════════════
    function evaluateHand(cards) {
        function getCombinations(arr, k) {
            const res = [];
            function combine(start, combo) {
                if (combo.length === k) { res.push([...combo]); return; }
                for (let i = start; i <= arr.length - (k - combo.length); i++)
                    combine(i + 1, [...combo, arr[i]]);
            }
            combine(0, []);
            return res;
        }
        const combos = getCombinations(cards, 5);
        let best = null;
        for (const c of combos) {
            const r = evaluate5CardHand(c);
            if (!best || r.value > best.value) best = r;
        }
        return best || evaluate5CardHand(cards.slice(0, 5));
    }

    function evaluate5CardHand(cards) {
        const rankOrder = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
        const cv = cards.map(c => ({
            rank: rankOrder.indexOf(c.rank), suit: c.suit, rankName: c.rank
        })).sort((a, b) => b.rank - a.rank);

        const isFlush = new Set(cv.map(c => c.suit)).size === 1;
        const ur = [...new Set(cv.map(c => c.rank))].sort((a, b) => b - a);
        let isStraight = false, straightHigh = 0;
        if (ur.length === 5) {
            if (ur[0] - ur[4] === 4) { isStraight = true; straightHigh = ur[0]; }
            if (!isStraight && ur[0] === 12 && ur[1] === 3 && ur[2] === 2 && ur[3] === 1 && ur[4] === 0) {
                isStraight = true; straightHigh = 3;
            }
        }
        const freq = {};
        cv.forEach(c => freq[c.rank] = (freq[c.rank] || 0) + 1);
        const groups = Object.entries(freq)
            .map(([r, c]) => ({ rank: parseInt(r), count: c }))
            .sort((a, b) => b.count - a.count || b.rank - a.rank);

        const BASE = 13, CAT = Math.pow(BASE, 5);
        function encodeGroups(g) {
            // Encode group ranks first (by count desc, then rank desc), then kicker ranks
            // This ensures Pair of 2s + Kings beats Pair of 2s + 10s
            let s = 0;
            // First pass: groups in order (already sorted by count desc, rank desc)
            g.forEach((x, i) => { s += x.rank * Math.pow(BASE, 4 - i); });
            return s;
        }
        function encodeGroupsWithKickers(g) {
            // Full encoding: grouped cards first, then kickers sorted desc
            // g is sorted by count desc, rank desc
            // Expand: for each group entry, repeat rank by count times
            const expanded = [];
            g.forEach(x => { for (let k = 0; k < x.count; k++) expanded.push(x.rank); });
            // Fill remaining slots up to 5 with already-sorted cv ranks not in the group list
            // (for hands like One Pair, Two Pair, Three of a Kind we need the kickers)
            let s = 0;
            expanded.slice(0, 5).forEach((r, i) => { s += r * Math.pow(BASE, 4 - i); });
            return s;
        }
        function encodeFlush() {
            let s = 0; cv.forEach((c, i) => { s += c.rank * Math.pow(BASE, 4 - i); }); return s;
        }

        if (isStraight && isFlush) return { value: 8 * CAT + straightHigh, name: straightHigh === 12 ? 'Royal Flush' : 'Straight Flush' };
        if (groups[0].count === 4) return { value: 7 * CAT + encodeGroups(groups), name: 'Four of a Kind' };
        if (groups[0].count === 3 && groups[1]?.count === 2) return { value: 6 * CAT + encodeGroups(groups), name: 'Full House' };
        if (isFlush) return { value: 5 * CAT + encodeFlush(), name: 'Flush' };
        if (isStraight) return { value: 4 * CAT + straightHigh, name: 'Straight' };
        if (groups[0].count === 3) return { value: 3 * CAT + encodeGroupsWithKickers(groups), name: 'Three of a Kind' };
        if (groups[0].count === 2 && groups[1]?.count === 2) return { value: 2 * CAT + encodeGroupsWithKickers(groups), name: 'Two Pair' };
        if (groups[0].count === 2) return { value: 1 * CAT + encodeGroupsWithKickers(groups), name: 'Pair' };
        return { value: encodeFlush(), name: 'High Card: ' + cv[0].rankName };
    }

    // ═══════════════════════════════════════════════════════════════
    //  START / RESET GAME
    // ═══════════════════════════════════════════════════════════════
    async function startGame() {
        if (!gameId) return;
        // Dispatch to blackjack engine if this is a BJ room
        if (gameState?.gameType === 'blackjack') { await bjStartHand(); return; }
        try {
            // Always read FRESH state from Firebase — never use local gameState here.
            // Using stale local state for chip values is what causes chips to vanish:
            // resetGame writes new chip totals, but if the local listener hasn't fired yet,
            // startGame reads old values and overwrites Firebase with them when posting blinds.
            const freshSnap  = await database.ref(`games/${gameId}`).once('value');
            const freshState = freshSnap.val();
            if (!freshState) return;

            // Second-line lock: if status is already 'playing' or 'starting' (another instance
            // already claimed it), abort immediately. The transaction in resetGame's setTimeout
            // is the primary lock; this catches any edge cases (e.g. manual Start button race).
            if (freshState.status === 'playing') return;

            const players    = freshState.players;
            if (!players) { await showAlert('Error: Game state not loaded', '❌'); return; }
            const allIds     = Object.keys(players);
            if (allIds.length < 2) { await showAlert('Need at least 2 players to start', '⚠️'); return; }

            const deck       = createDeck();
            const activeIds  = allIds.filter(id => players[id].chips > 0 && !players[id].sittingOut && !players[id].spectating && !players[id].pendingAdmit && !players[id].admittedNextHand && !players[id].admittedNextHand2);
            if (activeIds.length < 2) {
                // Not enough active players — don't start, just set waiting
                await database.ref(`games/${gameId}/status`).set('waiting');
                return;
            }
            const upd        = {};
            upd[`games/${gameId}/status`]              = 'playing';
            upd[`games/${gameId}/gameStarted`]         = true;  // permanent flag — never cleared
            upd[`games/${gameId}/round`]               = 'preflop';
            upd[`games/${gameId}/currentPlayerIndex`]  = 0;
            upd[`games/${gameId}/deck`]                = deck;
            upd[`games/${gameId}/currentBet`]          = BIG_BLIND;
            upd[`games/${gameId}/lastActivity`]        = Date.now();

            const prevDealer = freshState.dealerIndex || 0;
            const newDealer  = (prevDealer + 1) % activeIds.length;
            upd[`games/${gameId}/dealerIndex`] = newDealer;

            const sbIdx = newDealer % activeIds.length;
            const bbIdx = (newDealer + 1) % activeIds.length;
            const utg   = (newDealer + 2) % activeIds.length;

            let ci = 0, pot = 0;
            const acted = {};

            allIds.forEach(id => {
                if (players[id].chips <= 0 || players[id].sittingOut) {
                    upd[`games/${gameId}/players/${id}/folded`]   = true;
                    upd[`games/${gameId}/players/${id}/cards`]    = [];
                    upd[`games/${gameId}/players/${id}/bet`]      = 0;
                    upd[`games/${gameId}/players/${id}/observer`] = true;
                } else {
                    upd[`games/${gameId}/players/${id}/observer`] = false;
                }
            });

            activeIds.forEach((id, index) => {
                upd[`games/${gameId}/players/${id}/cards`]  = [deck[ci++], deck[ci++]];
                upd[`games/${gameId}/players/${id}/folded`] = false;
                acted[id] = false;

                if (activeIds.length === 2) {
                    if (index === sbIdx % 2) {
                        const b = Math.min(SMALL_BLIND, players[id].chips);
                        upd[`games/${gameId}/players/${id}/bet`]   = b;
                        upd[`games/${gameId}/players/${id}/chips`] = players[id].chips - b;
                        pot += b; addLog(`${players[id].name} posts Small Blind $${b}`);
                    } else {
                        const b = Math.min(BIG_BLIND, players[id].chips);
                        upd[`games/${gameId}/players/${id}/bet`]   = b;
                        upd[`games/${gameId}/players/${id}/chips`] = players[id].chips - b;
                        pot += b; addLog(`${players[id].name} posts Big Blind $${b}`);
                    }
                } else {
                    if (index === sbIdx) {
                        const b = Math.min(SMALL_BLIND, players[id].chips);
                        upd[`games/${gameId}/players/${id}/bet`]   = b;
                        upd[`games/${gameId}/players/${id}/chips`] = players[id].chips - b;
                        pot += b; addLog(`${players[id].name} posts Small Blind $${b}`);
                    } else if (index === bbIdx) {
                        const b = Math.min(BIG_BLIND, players[id].chips);
                        upd[`games/${gameId}/players/${id}/bet`]   = b;
                        upd[`games/${gameId}/players/${id}/chips`] = players[id].chips - b;
                        pot += b; addLog(`${players[id].name} posts Big Blind $${b}`);
                    } else {
                        upd[`games/${gameId}/players/${id}/bet`] = 0;
                    }
                }
            });

            upd[`games/${gameId}/playersActed`]        = acted;
            upd[`games/${gameId}/pot`]                 = pot;
            upd[`games/${gameId}/deckIndex`]           = ci;
            upd[`games/${gameId}/currentTurnPlayerId`] = activeIds[utg % activeIds.length] || activeIds[0];
            upd[`games/${gameId}/turnTimestamp`] = Date.now();

            await database.ref().update(upd);
            addLog('Game started! Good luck!');
            addLog(`Blinds: $${SMALL_BLIND}/$${BIG_BLIND} | Dealer: ${players[activeIds[newDealer]]?.name}`);
        } catch (err) {
            console.error('Error starting game:', err);
            await showAlert('Error starting game: ' + err.message, '❌');
        }
    }

    function createDeck() {
        const deck = [];
        for (const s of suits) for (const r of ranks) deck.push({ suit: s, rank: r });
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    async function resetGame() {
        // Transaction lock: only run resetGame once per hand.
        // Multiple callers (awardPotToPlayer, showdown, fold-to-one) all call resetGame —
        // the first to win this transaction proceeds; the rest abort silently.
        let resetAllowed = false;
        await database.ref(`games/${gameId}/status`).transaction(current => {
            if (current === 'playing' || current === 'gameover') {
                resetAllowed = true;
                return 'resetting'; // claim the reset
            }
            return undefined; // abort — already resetting, waiting, or starting
        });
        if (!resetAllowed) {
            console.warn('[RESET] Already claimed by another caller, skipping.');
            return;
        }

        const snap  = await database.ref(`games/${gameId}`).once('value');
        const state = snap.val();
        if (!state) return;

        const players       = state.players;
        // Game-over check: players with chips who haven't left.
        const effectiveWithChips = Object.entries(players).filter(([, p]) =>
            p.chips > 0 && !p.spectating && !p.pendingAdmit
            && !p.admittedNextHand && !p.admittedNextHand2 && !p.leftAt
        );
        // Active = has chips AND is not sitting out (can actually be dealt in)
        const activePlayers = effectiveWithChips.filter(([, p]) => !p.sittingOut);
        const upd           = {};

        // Game over if: only 1 player has chips, OR only 1 active (non-sitting-out) player remains.
        const gameOverByBankruptcy = effectiveWithChips.length <= 1;
        const gameOverBySitOut     = effectiveWithChips.length > 1 && activePlayers.length <= 1;
        if (gameOverByBankruptcy || gameOverBySitOut) {
            // GAME OVER
            const winnerEntry = gameOverBySitOut ? activePlayers[0] : effectiveWithChips[0];
            if (winnerEntry) {
                const [wid, w] = winnerEntry;
                const reason = gameOverBySitOut ? 'all other players sat out' : 'all other players went bankrupt';
                addLog(`👑 ${w.name} is the CHAMPION! (${reason})`);
                upd[`games/${gameId}/gameWinner`] = wid;
            }
            upd[`games/${gameId}/status`]        = 'gameover';
            upd[`games/${gameId}/pot`]            = 0;
            upd[`games/${gameId}/communityCards`] = [];
            upd[`games/${gameId}/currentBet`]     = 0;
            upd[`games/${gameId}/round`]          = 'preflop';
            upd[`games/${gameId}/playersActed`]   = {};
            for (const [id] of Object.entries(players)) {
                upd[`games/${gameId}/players/${id}/cards`]         = [];
                upd[`games/${gameId}/players/${id}/bet`]           = 0;
                upd[`games/${gameId}/players/${id}/folded`]        = false;
                upd[`games/${gameId}/players/${id}/revealedCards`] = null;
                upd[`games/${gameId}/players/${id}/handName`]      = null;
                upd[`games/${gameId}/players/${id}/observer`]      = null;
                upd[`games/${gameId}/players/${id}/loser`]         = null;
            }
            await database.ref().update(upd);
            return;
        }

        // NEXT HAND — apply pending sit-outs, reset per-round state
        addLog('Hand ended. Starting next hand in 3 seconds...');
        upd[`games/${gameId}/status`]        = 'waiting';
        upd[`games/${gameId}/pot`]            = 0;
        upd[`games/${gameId}/communityCards`] = [];
        upd[`games/${gameId}/currentBet`]     = 0;
        upd[`games/${gameId}/round`]          = 'preflop';
        upd[`games/${gameId}/playersActed`]   = {};
        upd[`games/${gameId}/gameWinner`]     = null;
        upd[`games/${gameId}/roundWinner`]    = null;
        upd[`games/${gameId}/turnTimestamp`]  = null;
        upd[`games/${gameId}/currentTurnPlayerId`] = null;

        for (const [id, p] of Object.entries(players)) {
            // Keep spectators/pending-admits in place — they don't get reset
            if (p.spectating || p.pendingAdmit) continue;

            // FIX 3: admittedNextHand — player was just admitted.
            // On the FIRST hand boundary, fully activate them (was previously two boundaries,
            // causing "Joining Next Round" to persist for two full hands).
            // admittedNextHand2 is kept for backward-compatibility with existing DB records.
            if (p.admittedNextHand || p.admittedNextHand2) {
                upd[`games/${gameId}/players/${id}/admittedNextHand`]  = false;
                upd[`games/${gameId}/players/${id}/admittedNextHand2`] = false;
                upd[`games/${gameId}/players/${id}/sittingOut`]        = false;
                upd[`games/${gameId}/players/${id}/observer`]          = false;
                upd[`games/${gameId}/players/${id}/sitOutReason`]      = null;
                upd[`games/${gameId}/players/${id}/spectating`]        = false;
                upd[`games/${gameId}/players/${id}/pendingAdmit`]      = false;
                upd[`games/${gameId}/players/${id}/cards`]             = [];
                upd[`games/${gameId}/players/${id}/bet`]               = 0;
                upd[`games/${gameId}/players/${id}/folded`]            = false;
                upd[`games/${gameId}/players/${id}/revealedCards`]     = null;
                upd[`games/${gameId}/players/${id}/handName`]          = null;
                upd[`games/${gameId}/players/${id}/loser`]             = null;
                upd[`games/${gameId}/players/${id}/timeoutFolds`]      = 0;
                addLog(`✅ ${p.name} is now in the game and will be dealt in next hand.`);
                continue;
            }

            if (p.chips <= 0) addLog(`${p.name} is out of chips and will observe.`);
            // Apply pending sit-out at hand boundary
            const pendingSitOut = !!p.sitOutPending;
            const nowSittingOut = !!p.sittingOut || pendingSitOut;
            upd[`games/${gameId}/players/${id}/cards`]         = [];
            upd[`games/${gameId}/players/${id}/bet`]           = 0;
            upd[`games/${gameId}/players/${id}/folded`]        = false;
            upd[`games/${gameId}/players/${id}/revealedCards`] = null;
            upd[`games/${gameId}/players/${id}/handName`]      = null;
            upd[`games/${gameId}/players/${id}/loser`]         = null;
            upd[`games/${gameId}/players/${id}/observer`]      = p.chips <= 0 || nowSittingOut;
            upd[`games/${gameId}/players/${id}/sittingOut`]    = nowSittingOut;
            upd[`games/${gameId}/players/${id}/sitOutPending`] = false;
            // Do NOT reset timeoutFolds here — it must persist across hands so that
            // 2 consecutive timeouts (even across different hands) correctly triggers sit-out.
            // It is only reset when the player manually acts or gets sat out.
            if (pendingSitOut && id === playerId) {
                isSittingOutPending = false;
                addLog(`💤 ${p.name} is now sitting out.`);
            }
        }
        // Record round played for all active non-observer players
        recordRoundPlayed();

        await database.ref().update(upd);

        setTimeout(async () => {
            // Only the room admin auto-starts the next hand.
            // Use a Firebase transaction as a distributed lock — even if two browser
            // instances (e.g. dual iframes on Google Sites) share the same playerId,
            // only the first one to win the transaction will call startGame().
            if (!gameId || !playerId) return;
            const chk = await database.ref(`games/${gameId}`).once('value');
            const cs  = chk.val();
            if (!cs || cs.status !== 'waiting') return;
            if (cs.adminId !== playerId) return;

            // Atomically flip status 'waiting' → 'starting'.
            // Only the instance that wins this transaction proceeds.
            const lockRef = database.ref(`games/${gameId}/status`);
            let won = false;
            await lockRef.transaction(current => {
                if (current === 'waiting') { won = true; return 'starting'; }
                return undefined; // abort — another instance already won
            });
            if (!won) return;
            await startGame();
        }, 3000);
    }

    // Back to Lobby: reset game state to waiting so new players can join and a new game can start
    async function backToLobby() {
        const snap  = await database.ref(`games/${gameId}`).once('value');
        const state = snap.val();
        if (!state) return;

        const upd = {};
        upd[`games/${gameId}/status`]             = 'waiting';
        upd[`games/${gameId}/pot`]                = 0;
        upd[`games/${gameId}/communityCards`]     = [];
        upd[`games/${gameId}/currentBet`]         = 0;
        upd[`games/${gameId}/round`]              = 'preflop';
        upd[`games/${gameId}/playersActed`]       = {};
        upd[`games/${gameId}/gameWinner`]         = null;
        upd[`games/${gameId}/roundWinner`]        = null;
        upd[`games/${gameId}/deck`]               = null;
        upd[`games/${gameId}/turnTimestamp`]      = null;
        upd[`games/${gameId}/currentTurnPlayerId`] = null;
        upd[`games/${gameId}/lastActivity`]       = Date.now();

        // Reset ALL players to fresh $1000 for a new game — so the room is ready to start fresh
        for (const [id] of Object.entries(state.players || {})) {
            upd[`games/${gameId}/players/${id}/chips`]         = 1000;
            upd[`games/${gameId}/players/${id}/cards`]         = [];
            upd[`games/${gameId}/players/${id}/bet`]           = 0;
            upd[`games/${gameId}/players/${id}/folded`]        = false;
            upd[`games/${gameId}/players/${id}/revealedCards`] = null;
            upd[`games/${gameId}/players/${id}/handName`]      = null;
            upd[`games/${gameId}/players/${id}/observer`]      = false;
            upd[`games/${gameId}/players/${id}/loser`]         = null;
            upd[`games/${gameId}/players/${id}/sittingOut`]    = false;
            upd[`games/${gameId}/players/${id}/timeoutFolds`]  = 0;
        }

        await database.ref().update(upd);
        addLog('Game ended. Returned to lobby — new players can join! Admin can start a new game when ready.');
        await database.ref(`games/${gameId}/chat`).push({
            senderId: 'system',
            senderName: '🎲 System',
            message: '🏠 The game has ended. Room is now open — new players can join!',
            timestamp: Date.now()
        });
    }

    async function playAgain() {
        const snap  = await database.ref(`games/${gameId}`).once('value');
        const state = snap.val();
        if (!state) return;

        const upd = {};
        upd[`games/${gameId}/status`]              = 'waiting';
        upd[`games/${gameId}/pot`]                 = 0;
        upd[`games/${gameId}/communityCards`]      = [];
        upd[`games/${gameId}/currentBet`]          = 0;
        upd[`games/${gameId}/round`]               = 'preflop';
        upd[`games/${gameId}/playersActed`]        = {};
        upd[`games/${gameId}/gameWinner`]          = null;
        upd[`games/${gameId}/roundWinner`]         = null;
        upd[`games/${gameId}/deck`]                = null;
        upd[`games/${gameId}/gameStarted`]         = null;   // reset so start button shows and joining is free
        upd[`games/${gameId}/turnTimestamp`]       = null;
        upd[`games/${gameId}/currentTurnPlayerId`] = null;

        for (const [id] of Object.entries(state.players)) {
            upd[`games/${gameId}/players/${id}/chips`]         = 1000;
            upd[`games/${gameId}/players/${id}/cards`]         = [];
            upd[`games/${gameId}/players/${id}/bet`]           = 0;
            upd[`games/${gameId}/players/${id}/folded`]        = false;
            upd[`games/${gameId}/players/${id}/revealedCards`] = null;
            upd[`games/${gameId}/players/${id}/handName`]      = null;
            upd[`games/${gameId}/players/${id}/observer`]      = false;
            upd[`games/${gameId}/players/${id}/loser`]         = null;
            upd[`games/${gameId}/players/${id}/sittingOut`]    = false;
            upd[`games/${gameId}/players/${id}/timeoutFolds`]  = 0;
        }

        await database.ref().update(upd);
        addLog('New game started! Everyone gets $1000. Good luck!');
    }

    // ═══════════════════════════════════════════════════════════════
    //  KICK / PROMOTE
    // ═══════════════════════════════════════════════════════════════
    // Show or update the pending-admit notification banner
    function showAdmitNotification(names) {
        // Remove existing banner if present
        const old = document.getElementById('admitNotifBanner');
        if (old) { old.remove(); if (_admitNotifTimeout) clearTimeout(_admitNotifTimeout); }

        const isAdmin = gameState?.adminId === playerId;
        const count = names.length;
        const nameList = names.slice(0, 2).join(', ') + (count > 2 ? ` +${count - 2} more` : '');

        const banner = document.createElement('div');
        banner.id = 'admitNotifBanner';
        banner.className = 'spectator-notify-banner';
        banner.innerHTML =
            `<div class="notify-icon">👁️</div>
             <div class="notify-body">
                 <div>${count === 1 ? `<b>${escapeHtml(names[0])}</b> wants to watch` : `<b>${count} players</b> want to watch`}</div>
                 <div class="notify-name">${escapeHtml(nameList)}</div>
             </div>
             ${isAdmin ? `<div class="notify-action">Open Admin Panel</div>` : '<div class="notify-action">Ask the admin</div>'}
             <div class="notify-close">✕</div>`;

        // Admin click → open admin panel; anyone click → dismiss
        banner.addEventListener('click', (e) => {
            if (isAdmin && !e.target.classList.contains('notify-close')) {
                document.getElementById('adminPanelBtn')?.click();
            }
            dismissAdmitNotification();
        });

        document.body.appendChild(banner);

        // Auto-dismiss after 12s
        _admitNotifTimeout = setTimeout(dismissAdmitNotification, 12000);
    }

    function dismissAdmitNotification() {
        const banner = document.getElementById('admitNotifBanner');
        if (!banner) return;
        banner.classList.add('notify-exit');
        setTimeout(() => banner.remove(), 280);
        if (_admitNotifTimeout) { clearTimeout(_admitNotifTimeout); _admitNotifTimeout = null; }
    }

    // Called from listenToGame whenever game state changes —
    // detects NEW pendingAdmit players and fires a notification
    function checkForNewPendingAdmits(state) {
        if (!state?.players) return;
        const currentPending = Object.entries(state.players)
            .filter(([, p]) => p.pendingAdmit && p.name);
        const currentIds = new Set(currentPending.map(([id]) => id));

        // Find truly NEW arrivals (not previously notified)
        const newArrivals = currentPending.filter(([id]) => !_prevPendingAdmitSet.has(id));

        // Update our tracking set to exactly the current pending set
        _prevPendingAdmitSet = currentIds;

        if (newArrivals.length > 0) {
            // Show notification with all currently pending names
            const allNames = currentPending.map(([, p]) => p.name);
            showAdmitNotification(allNames);
        } else if (currentIds.size === 0) {
            // All admitted/rejected — dismiss any lingering banner
            dismissAdmitNotification();
        } else if (currentIds.size !== (document.getElementById('admitNotifBanner') ? -1 : 0)) {
            // Count changed (someone admitted/rejected while others still pending) — refresh
            if (document.getElementById('admitNotifBanner')) {
                const allNames = currentPending.map(([, p]) => p.name);
                showAdmitNotification(allNames);
            }
        }
    }

    async function admitSpectator(targetId) {
        // FIX 6: Allow room admin OR game admin to admit spectators
        if (!gameState || (gameState.adminId !== playerId && !isGameAdmin)) return;
        // Always re-read fresh state so we don't use stale data
        const freshSnap = await database.ref(`games/${gameId}`).once('value');
        const freshState = freshSnap.val();
        if (!freshState) return;
        const target = freshState.players?.[targetId];
        if (!target || !target.name) return;

        // Admitted players are ALWAYS queued for the next round — never dealt in immediately.
        // admittedNextHand: true  → resetGame skips them this boundary, sets admittedNextHand2
        // admittedNextHand2: true → resetGame on the FOLLOWING boundary fully activates them
        // This two-round buffer ensures they never interfere with an in-progress hand.
        await database.ref(`games/${gameId}/players/${targetId}`).update({
            spectating:        false,
            pendingAdmit:      false,
            observer:          true,           // kept out of turn order
            sittingOut:        true,           // always sit out until they're properly dealt in
            admittedNextHand:  true,           // cleared by resetGame at next hand boundary
            admittedNextHand2: false,          // set by resetGame, cleared the hand after
            sitOutReason:      'admitted',
        });

        addLog(`✅ ${target.name} admitted — joins from the next round.`);
        await database.ref(`games/${gameId}/chat`).push({
            senderId: 'system', senderName: '🎲 System',
            message: `✅ ${target.name} has been admitted and will join from the next round.`,
            timestamp: Date.now()
        });
        dismissAdmitNotification();
        if (!document.getElementById('adminPanelModal').classList.contains('hidden')) renderAdminPanel();
    }

    // Admin: force a player to sit out next hand
    async function adminSitOutPlayer(targetId) {
        // FIX 6: Allow room admin OR game admin
        if (!gameState || (gameState.adminId !== playerId && !isGameAdmin)) return;
        const target = gameState.players?.[targetId];
        if (!target || !target.name || target.sittingOut) return; // already sitting out

        await database.ref(`games/${gameId}/players/${targetId}`).update({
            sitOutPending: true,
            sitOutReason:  'admin'
        });
        addLog(`💤 Admin sat out ${target.name}.`);
        await database.ref(`games/${gameId}/chat`).push({
            senderId: 'system', senderName: '🎲 System',
            message: `💤 ${target.name} has been sat out by the admin.`,
            timestamp: Date.now()
        });
        if (!document.getElementById('adminPanelModal').classList.contains('hidden')) renderAdminPanel();
    }

    async function kickPlayer(targetId) {
        // FIX 6: Allow room admin OR game admin to kick players
        if (!gameState || (gameState.adminId !== playerId && !isGameAdmin)) return;
        // Fetch fresh state — don't rely on stale gameState for kick logic
        const freshSnap = await database.ref(`games/${gameId}`).once('value');
        const freshState = freshSnap.val();
        if (!freshState) return;
        const target = freshState.players?.[targetId];
        if (!target) return;
        // FIX 6: Kick permission hierarchy.
        // Room admins CAN kick game admins — this is intentional per spec.
        // Game admins are only protected from OTHER game admins (not from room admins).
        // So: if the kicker IS a game admin (but not head admin), block kicking other game admins.
        if (isGameAdmin && !isHeadAdmin && target.username) {
            const targetUid = target.username.toLowerCase();
            try {
                const gaSnap = await database.ref(`gameAdmins/${targetUid}`).once('value');
                if (gaSnap.exists() && gaSnap.val() === true) {
                    await showAlert('Game Admins cannot kick other Game Admins.', '🛡️'); return;
                }
            } catch(e) {}
        }
        // Head admin can kick anyone; room admins (non-game-admin) can kick anyone including game admins.
        if (!await showConfirm(`Kick ${target.name} from the room?`, '🚫')) return;

        const upd = {};
        // Notify the kicked client
        upd[`games/${gameId}/kicked/${targetId}`] = true;

        // ── SAFE KICK: if it's the kicked player's turn, advance first ──
        const wasTheirTurn = freshState.currentTurnPlayerId === targetId;
        if (freshState.status === 'playing' && wasTheirTurn) {
            // Mark them folded, find next player
            const updPlayers = JSON.parse(JSON.stringify(freshState.players));
            updPlayers[targetId] = { ...updPlayers[targetId], folded: true };
            const remaining = Object.entries(updPlayers).filter(([id, p]) => id !== targetId && !p.folded && !p.leftAt && !p.spectating && !p.pendingAdmit && !p.observer);
            if (remaining.length === 1) {
                // Only one player left — award pot
                upd[`games/${gameId}/players/${targetId}`] = null;
                upd[`games/${gameId}/currentTurnPlayerId`] = null;
                await database.ref().update(upd);
                setTimeout(() => awardPotToPlayer(remaining[0][0]), 800);
            } else {
                const nextId = getNextTurnPlayerId(targetId, updPlayers);
                upd[`games/${gameId}/players/${targetId}`] = null;
                upd[`games/${gameId}/currentTurnPlayerId`] = nextId;
                upd[`games/${gameId}/turnTimestamp`] = Date.now();
                await database.ref().update(upd);
            }
        } else if (freshState.status === 'playing') {
            // Not their turn — fold them silently, remove, let betting round re-check
            upd[`games/${gameId}/players/${targetId}`] = null;
            await database.ref().update(upd);
            setTimeout(() => checkBettingRoundComplete(), 800);
        } else {
            // Not in an active game — just remove
            upd[`games/${gameId}/players/${targetId}`] = null;
            await database.ref().update(upd);
        }

        // Persist kicked record so they can't rejoin via localStorage
        if (target.username) {
            database.ref(`users/${target.username.toLowerCase()}/kickedFrom`).set({
                roomId: gameId, at: Date.now()
            }).catch(() => {});
        }
        addLog(`${target.name} was kicked from the room.`);
        setTimeout(() => database.ref(`games/${gameId}/kicked/${targetId}`).remove().catch(() => {}), 5000);
        if (!document.getElementById('adminPanelModal').classList.contains('hidden')) renderAdminPanel();
    }

    async function promotePlayer(targetId) {
        // FIX 6: Only room admin can promote (game admins cannot override room admin hierarchy)
        if (!gameState || gameState.adminId !== playerId) return;
        const target = gameState.players[targetId];
        if (!target) return;
        await database.ref(`games/${gameId}/adminId`).set(targetId);
        addLog(`👑 ${target.name} is now the room admin.`);
    }

    // ═══════════════════════════════════════════════════════════════
    //  LEAVE GAME
    // ═══════════════════════════════════════════════════════════════
    async function leaveGame(silent = false, inactivity = false) {
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
        if (cleanupInterval)   { clearInterval(cleanupInterval);   cleanupInterval = null; }
        if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
        if (playerTimerInterval) { clearInterval(playerTimerInterval); playerTimerInterval = null; }
        stopTurnTimer(true);

        const leavingGameId = gameId;
        const leavingPlayerId = playerId;

        if (leavingGameId && leavingPlayerId) {
            // Detach all Firebase listeners FIRST to prevent stale callbacks
            database.ref(`games/${leavingGameId}`).off();
            database.ref(`games/${leavingGameId}/chat`).off();
            if (globalChatRef) { globalChatRef.off(); globalChatRef = null; }
            gcwListenerActive = false;

            try {
                const snap  = await database.ref(`games/${leavingGameId}`).once('value');
                const state = snap.val();

                if (state) {
                    // Helper: hand off admin to a random active remaining player
                    async function transferAdminIfNeeded(st, leavingId) {
                        if (st.adminId !== leavingId) return;
                        const others = Object.keys(st.players || {})
                            .filter(id => id !== leavingId && !st.players[id].leftAt);
                        if (others.length === 0) return;
                        const newAdmin = others[Math.floor(Math.random() * others.length)];
                        await database.ref(`games/${leavingGameId}/adminId`).set(newAdmin);
                        await database.ref(`games/${leavingGameId}/chat`).push({
                            senderId: 'system',
                            senderName: '🎲 System',
                            message: `${st.players[newAdmin]?.name || 'Someone'} is now the room admin.`,
                            timestamp: Date.now()
                        });
                    }

                    // If leaving during active game, mark leftAt for rejoin window
                    if (state.status === 'playing' && !inactivity) {
                        await transferAdminIfNeeded(state, leavingPlayerId);
                        // If it's our turn, fold and advance before marking leftAt
                        if (state.currentTurnPlayerId === leavingPlayerId) {
                            const updPl = JSON.parse(JSON.stringify(state.players));
                            updPl[leavingPlayerId] = { ...updPl[leavingPlayerId], folded: true };
                            const rem = Object.entries(updPl).filter(([id, p]) => !p.folded && id !== leavingPlayerId && !p.spectating && !p.pendingAdmit && !p.observer);
                            if (rem.length === 1) {
                                await database.ref(`games/${leavingGameId}/players/${leavingPlayerId}`).update({ leftAt: Date.now(), isActive: false, folded: true });
                                await database.ref(`games/${leavingGameId}/currentTurnPlayerId`).set(null);
                                setTimeout(() => awardPotToPlayer(rem[0][0]), 1000);
                            } else {
                                const nextId = getNextTurnPlayerId(leavingPlayerId, updPl);
                                await database.ref(`games/${leavingGameId}/players/${leavingPlayerId}`).update({ leftAt: Date.now(), isActive: false, folded: true });
                                await database.ref(`games/${leavingGameId}`).update({ currentTurnPlayerId: nextId, turnTimestamp: Date.now() });
                            }
                        } else {
                            await database.ref(`games/${leavingGameId}/players/${leavingPlayerId}/leftAt`).set(Date.now());
                            await database.ref(`games/${leavingGameId}/players/${leavingPlayerId}/isActive`).set(false);
                        }

                        // ── CRITICAL: if room is now completely empty, delete it immediately ──
                        // Re-read players fresh after our write so we have accurate state
                        const afterPlayingSnap = await database.ref(`games/${leavingGameId}/players`).once('value');
                        const afterPlayers = afterPlayingSnap.val() || {};
                        const anyoneActive = Object.values(afterPlayers).some(p => p.isActive && !p.leftAt);
                        if (!anyoneActive) {
                            await database.ref(`games/${leavingGameId}`).remove();
                        }
                    } else {
                        // Admin handoff
                        await transferAdminIfNeeded(state, leavingPlayerId);
                        await database.ref(`games/${leavingGameId}/players/${leavingPlayerId}`).remove();

                        // Delete empty room
                        const afterSnap = await database.ref(`games/${leavingGameId}/players`).once('value');
                        if (!afterSnap.exists() || Object.keys(afterSnap.val() || {}).length === 0) {
                            await database.ref(`games/${leavingGameId}`).remove();
                        }
                    }
                }
            } catch (e) { /* silent */ }
        }

        clearSavedGame();

        gameScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        document.getElementById('globalChatWidget')?.classList.remove('hidden');

        roomCodeInput.value = '';
        hideRoomOptions();

        gameId     = null;
        playerId   = null;
        gameState  = null;

        if (chatContainer)       chatContainer.innerHTML = '';
        if (globalChatContainer) globalChatContainer.innerHTML = '';
        if (chatInput)           chatInput.value = '';

        document.getElementById('gameOverScreen')?.remove();
        document.getElementById('sittingOutPanel')?.classList.add('hidden');
        document.getElementById('myWinnerLabel')?.remove();
        document.getElementById('myHandName')?.remove();
        document.querySelector('.player-hand')?.classList.remove('game-winner-me');
        document.getElementById('adminPanelModal')?.classList.add('hidden');
        document.getElementById('dmModal')?.classList.add('hidden');
    }

    // ═══════════════════════════════════════════════════════════════
    //  GAME LOG
    // ═══════════════════════════════════════════════════════════════
    function addLog(msg) {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logContainer.appendChild(entry);
        // Only auto-scroll if the log tab is active to avoid layout thrash
        if (activeChatTab === 'log') {
            requestAnimationFrame(() => { logContainer.scrollTop = logContainer.scrollHeight; });
        }
        // Show unread indicator on log tab when not active
        const logTabBtn = document.getElementById('tabLog');
        if (logTabBtn && activeChatTab !== 'log') logTabBtn.classList.add('has-unread');
    }

    // ═══════════════════════════════════════════════════════════════
    //  PUBLIC ROOMS BROWSER
    // ═══════════════════════════════════════════════════════════════
    async function loadPublicRooms() {
        const listEl = document.getElementById('publicRoomsList');
        if (!listEl) return;
        listEl.innerHTML = '<p class="rooms-loading">Loading rooms...</p>';
        try {
            const snap  = await database.ref('games').once('value');
            const games = snap.val() || {};

            // A player is "present" only if actively connected (isActive=true, no leftAt).
            const realCount = (g) => Object.values(g.players || {}).filter(p =>
                p.isActive && !p.leftAt && !p.spectating && !p.pendingAdmit
            ).length;
            const activeCount = (g) => Object.values(g.players || {}).filter(p =>
                p.isActive && !p.leftAt && !p.spectating && !p.pendingAdmit
            ).length;

            // Filter to the selected game type tab and open rooms
            const filterType = selectedRoomType || 'poker';
            const public_rooms = Object.entries(games).filter(([, g]) => {
                const pc = realCount(g);
                const ac = activeCount(g);
                if (!g.isPublic || pc < 1) return false;
                // Match selected game type (rooms without gameType field are treated as poker)
                const gType = g.gameType || 'poker';
                if (gType !== filterType) return false;
                // Show waiting/gameover rooms with open slots
                if ((g.status === 'waiting' || g.status === 'gameover') && pc < g.maxPlayers) return true;
                // Show in-progress rooms with open spectator slots
                if ((g.status === 'playing' || g.status === 'bjBetting' || g.status === 'bjDealing') && ac < g.maxPlayers) return true;
                return false;
            });

            listEl.innerHTML = '';

            if (public_rooms.length === 0) {
                const typeLabel = filterType === 'blackjack' ? '🎰 Blackjack' : '🃏 Poker';
                listEl.innerHTML = `<p class="rooms-empty">No open ${typeLabel} rooms right now.<br>Create one or join by code!</p>`;
            } else {
                public_rooms.forEach(([id, g]) => {
                    const pc  = realCount(g);
                    const isPlaying = g.status === 'playing' || g.status === 'bjBetting' || g.status === 'bjDealing';
                    const host = g.createdBy || '';
                    const row = document.createElement('div');
                    row.className = 'public-room-row';
                    row.innerHTML =
                        `<div class="pr-info">
                            <div>
                                <div style="display:flex;align-items:center;gap:6px;">
                                    <span class="pr-code">${id}</span>
                                    <span class="pr-status-badge ${isPlaying ? 'playing' : 'waiting'}">${isPlaying ? '🟠 In Game' : '🟢 Waiting'}</span>
                                </div>
                                <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
                                    <span class="pr-players">👥 ${pc}/${g.maxPlayers}</span>
                                    ${host ? `<span class="pr-host">by ${escapeHtml(host)}</span>` : ''}
                                </div>
                                ${isPlaying ? `<div style="font-size:0.71em;color:rgba(255,152,0,0.75);margin-top:2px;">👁️ Join as spectator</div>` : ''}
                            </div>
                        </div>` +
                        `<button class="pr-join-btn${isPlaying ? ' spectate-btn' : ''}">${isPlaying ? '👁️ Watch' : 'Join'}</button>`;
                    row.querySelector('.pr-join-btn').addEventListener('click', () => {
                        document.getElementById('roomCodeInput').value = id;
                        document.getElementById('joinTabCode').classList.add('active');
                        document.getElementById('joinTabBrowse').classList.remove('active');
                        document.getElementById('joinByCode').classList.remove('hidden');
                        document.getElementById('joinByBrowse').classList.add('hidden');
                        document.getElementById('roomCodeInput').focus();
                    });
                    listEl.appendChild(row);
                });
            }

            const refresh = document.createElement('button');
            refresh.className = 'rooms-refresh-btn';
            refresh.textContent = '🔄 Refresh';
            refresh.addEventListener('click', () => runLobbyCleanup().then(() => loadPublicRooms()));
            listEl.appendChild(refresh);
        } catch (err) {
            listEl.innerHTML = '<p class="rooms-empty">Error loading rooms.</p>';
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  VERSION CHECK
    // ═══════════════════════════════════════════════════════════════
    async function checkVersionOutdated() {
        try {
            const snap   = await database.ref('meta/latestVersion').once('value');
            const latest = snap.val();
            if (latest && latest !== GAME_VERSION) showOutdatedBanner(latest);
        } catch (e) {}
    }

    function showOutdatedBanner(latest) {
        if (document.getElementById('outdatedBanner')) return;
        const b = document.createElement('div');
        b.id = 'outdatedBanner';
        b.className = 'outdated-banner';
        b.innerHTML =
            `⚠️ You're on <strong>${GAME_VERSION}</strong> — newer version <strong>${latest}</strong> available. ` +
            `<a href="javascript:location.reload(true)">Refresh to update</a>` +
            `<button class="outdated-close" onclick="this.parentElement.remove()">✕</button>`;
        document.body.appendChild(b);
    }

    // ═══════════════════════════════════════════════════════════════
    //  ROOM CLEANUP  (empty/stale rooms)
    // ═══════════════════════════════════════════════════════════════
    function startRoomCleanup() {
        if (cleanupInterval) return;
        cleanupInterval = setInterval(async () => {
            const snap  = await database.ref('games').once('value');
            const games = snap.val();
            if (!games) return;

            const now = Date.now();
            for (const [roomId, game] of Object.entries(games)) {
                const allPlayers = game.players || {};

                // A player is truly present only if isActive=true and no leftAt.
                // Anyone with leftAt set or isActive=false has disconnected/left.
                const activePlayerCount = Object.values(allPlayers).filter(p =>
                    p.isActive && !p.leftAt
                ).length;

                const lastActivity = game.lastActivity || game.createdAt || 0;

                if (activePlayerCount === 0) {
                    // Room is completely empty — delete it immediately
                    await database.ref(`games/${roomId}`).remove();
                } else if (now - lastActivity > INACTIVITY_MS) {
                    // Room has been idle for 1hr — remove it
                    await database.ref(`games/${roomId}`).remove();
                }
            }
        }, 15000);
    }

    // ── Also run a one-shot cleanup from the lobby so orphaned rooms
    //    (where all players closed their tabs) get purged immediately
    //    without waiting for another player to enter a room.
    async function runLobbyCleanup() {
        try {
            const snap  = await database.ref('games').once('value');
            const games = snap.val();
            if (!games) return;
            const now = Date.now();
            for (const [roomId, game] of Object.entries(games)) {
                const allPlayers = game.players || {};
                const activeCount = Object.values(allPlayers).filter(p => p.isActive && !p.leftAt).length;
                const lastActivity = game.lastActivity || game.createdAt || 0;
                if (activeCount === 0 || now - lastActivity > INACTIVITY_MS) {
                    await database.ref(`games/${roomId}`).remove();
                }
            }
        } catch(e) { /* silent */ }
    }

    window.addEventListener('beforeunload', () => {
        presenceRef.remove();
        if (gameId && playerId && gameState) {
            // Only mark leftAt (enable rejoin) if a game is actively in progress.
            // In waiting status, just remove the slot outright — no rejoin needed,
            // and this prevents the ghost-player count bug in the room browser.
            if (gameState.status === 'playing') {
                database.ref(`games/${gameId}/players/${playerId}`).update({ leftAt: Date.now(), isActive: false });
            } else {
                // Remove immediately — no rejoin window needed for lobby departures
                database.ref(`games/${gameId}/players/${playerId}`).remove();
            }
        }
        if (cleanupInterval)    clearInterval(cleanupInterval);
        if (heartbeatInterval)  clearInterval(heartbeatInterval);
        if (turnTimerInterval)  clearInterval(turnTimerInterval);
        if (playerTimerInterval) clearInterval(playerTimerInterval);
        // Detach all Firebase listeners to prevent post-unload callbacks
        if (gameId) {
            database.ref(`games/${gameId}`).off();
            database.ref(`games/${gameId}/chat`).off();
        }
        if (globalChatRef) globalChatRef.off();
    });

    // ── Firebase onDisconnect also removes player cleanly on hard disconnect ──
    // (This is set in setupPresenceTracking via playerRef.onDisconnect().update)

    // ═══════════════════════════════════════════════════════════════
    //  GAME ADMIN PANEL  (global super-admin powers)
    //  Setup: in Firebase, set gameAdmins/{uid} = true for admins
    // ═══════════════════════════════════════════════════════════════
    document.getElementById('gameAdminBtn')?.addEventListener('click', openGameAdminPanel);
    document.getElementById('closeGameAdminBtn')?.addEventListener('click', () => {
        document.getElementById('gameAdminModal').classList.add('hidden');
    });
    document.getElementById('gameAdminModal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('gameAdminModal'))
            document.getElementById('gameAdminModal').classList.add('hidden');
    });
    document.getElementById('gaSearchBtn')?.addEventListener('click', gaSearchUser);
    document.getElementById('gaSearchInput')?.addEventListener('keypress', e => {
        if (e.key === 'Enter') gaSearchUser();
    });

    async function openGameAdminPanel() {
        if (!isGameAdmin) return;
        document.getElementById('gameAdminModal').classList.remove('hidden');
        loadGaBanList();
    }

    // ── Admin hierarchy helper ────────────────────────────────────
    // Returns true if the currently logged-in admin is allowed to act on targetUid.
    // Strict top-down: Head Admin > Game Admin > Room Admin > Player.
    // A Game Admin cannot act on the Head Admin or other Game Admins.
    async function canActOn(targetUid) {
        if (!isGameAdmin) return false;
        if (isHeadAdmin) return true; // Head Admin has universal authority
        // Game Admin: blocked from acting on Head Admin
        if (headAdminUid && targetUid === headAdminUid) return false;
        // Game Admin: blocked from acting on other Game Admins
        const targetGaSnap = await database.ref(`gameAdmins/${targetUid}`).once('value');
        if (targetGaSnap.exists() && targetGaSnap.val() === true) return false;
        return true;
    }

    async function gaSearchUser() {
        if (!isGameAdmin) return;
        const q = document.getElementById('gaSearchInput').value.trim().toLowerCase();
        if (!q) return;
        const resultsEl = document.getElementById('gaResults');
        resultsEl.innerHTML = '<div class="dm-loading">Searching...</div>';

        const snap = await database.ref(`users/${q}`).once('value');
        if (!snap.exists()) {
            resultsEl.innerHTML = '<div class="dm-empty-hint">User not found.</div>';
            return;
        }
        const u = snap.val();
        const uid = q;

        // Determine target role for hierarchy enforcement
        const targetIsHead = headAdminUid && uid === headAdminUid;
        const targetGaSnap = await database.ref(`gameAdmins/${uid}`).once('value');
        const targetIsGameAdmin = targetGaSnap.exists() && targetGaSnap.val() === true;
        const actAllowed = await canActOn(uid);

        const banSnap = await database.ref(`chatBans/${uid}`).once('value');
        const ban = banSnap.val();
        const isBanned = ban && (ban.permanent || (ban.until && ban.until > Date.now()));

        let roleBadge = '';
        if (targetIsHead) roleBadge = '<span style="background:rgba(255,50,50,0.2);border:1px solid rgba(255,80,80,0.5);border-radius:8px;padding:1px 6px;font-size:0.75em;color:#ff8a80;margin-left:6px;">⭐ Head Admin</span>';
        else if (targetIsGameAdmin) roleBadge = '<span style="background:rgba(156,39,176,0.2);border:1px solid rgba(156,39,176,0.5);border-radius:8px;padding:1px 5px;font-size:0.75em;color:#ce93d8;margin-left:6px;">🛡️ Game Admin</span>';

        let actionsHtml = '';
        if (!actAllowed) {
            actionsHtml = `<div style="color:rgba(255,152,0,0.85);font-size:0.88em;margin-top:6px;">🔒 You do not have permission to take action against this account.</div>`;
        } else {
            actionsHtml = `
                <div class="ga-actions">
                    <button class="admin-danger-btn" id="gaDeleteBtn">🗑️ Delete Account</button>
                    ${isBanned
                        ? `<button class="admin-ok-btn" id="gaUnbanBtn">✅ Unban Chat</button>`
                        : `<button class="admin-warn-btn" id="gaTempBanBtn">⏱️ Temp Ban Chat (24h)</button>
                           <button class="admin-danger-btn" id="gaPermBanBtn">🚫 Perm Ban Chat</button>`
                    }
                </div>`;
        }

        resultsEl.innerHTML = `
            <div class="ga-user-card">
                <div class="ga-user-name">👤 ${escapeHtml(u.username)}${roleBadge} <span style="opacity:0.5;font-size:0.85em;">(${uid})</span></div>
                <div class="ga-user-meta">Registered: ${new Date(u.createdAt||0).toLocaleDateString()} | Last seen: ${new Date(u.lastSeen||0).toLocaleString()}</div>
                ${actionsHtml}
                ${isBanned && actAllowed ? `<div style="color:#ff6b6b;margin-top:6px;">⚠️ Currently chat banned${ban.permanent ? ' (permanent)' : ` until ${new Date(ban.until).toLocaleString()}`}</div>` : ''}
            </div>`;

        if (actAllowed) {
            document.getElementById('gaDeleteBtn')?.addEventListener('click', () => gaDeleteAccount(uid, u.username));
            document.getElementById('gaUnbanBtn')?.addEventListener('click', () => gaUnbanChat(uid, u.username));
            document.getElementById('gaTempBanBtn')?.addEventListener('click', () => gaBanChat(uid, u.username, false));
            document.getElementById('gaPermBanBtn')?.addEventListener('click', () => gaBanChat(uid, u.username, true));
        }
    }

    async function gaDeleteAccount(uid, username) {
        if (!isGameAdmin) return;
        // Enforce strict hierarchy: use canActOn for all privilege checks
        if (!await canActOn(uid)) {
            await showAlert('You do not have permission to delete this account.\nThe admin hierarchy prevents this action.', '🔒');
            return;
        }
        if (!await showConfirm(`⚠️ PERMANENTLY delete account "${username}"?\nThis cannot be undone.`, '🗑️')) return;
        if (!await showConfirm(`Are you ABSOLUTELY sure?\nDeleting: ${username}`, '⚠️')) return;
        // Write a deletion tombstone first so all live sessions detect it
        await database.ref(`deletedAccounts/${uid}`).set({ deletedAt: Date.now() });
        // Ban from chat so stale sessions can't post even before logout
        await database.ref(`chatBans/${uid}`).set({ permanent: true, deletedAccount: true, bannedAt: Date.now() });
        // Write deletedAt onto the user node before removal so ghost-check in registration works
        // even if the remove() races with a re-registration attempt
        await database.ref(`users/${uid}/deletedAt`).set(Date.now());
        await database.ref(`users/${uid}`).remove();
        // Remove from any active games — safely advance turns if needed
        const gamesSnap = await database.ref('games').once('value');
        if (gamesSnap.exists()) {
            for (const [gid, g] of Object.entries(gamesSnap.val())) {
                if (!g.players) continue;
                for (const [pid, p] of Object.entries(g.players)) {
                    if (!p.username || p.username.toLowerCase() !== uid) continue;
                    if (g.currentTurnPlayerId === pid && g.status === 'playing') {
                        const updPl = JSON.parse(JSON.stringify(g.players));
                        updPl[pid] = { ...updPl[pid], folded: true };
                        const rem = Object.entries(updPl).filter(([id, pl]) => id !== pid && !pl.folded && !pl.spectating && !pl.pendingAdmit && !pl.observer);
                        const nextId = rem.length === 1 ? null : getNextTurnPlayerId(pid, updPl);
                        await database.ref(`games/${gid}`).update({
                            [`players/${pid}`]: null,
                            currentTurnPlayerId: nextId,
                            turnTimestamp: Date.now()
                        });
                        if (rem.length === 1) setTimeout(() => awardPotToPlayer(rem[0][0]), 800);
                    } else {
                        await database.ref(`games/${gid}/players/${pid}`).remove();
                    }
                }
            }
        }
        // Release the username so it can be re-registered (see Issue #4)
        await database.ref(`usernameTombstones/${uid}`).remove();
        const resultsEl2 = document.getElementById('gaResults');
        if (resultsEl2) resultsEl2.innerHTML = `<div class="ga-user-card" style="border-color:rgba(76,175,80,0.5)"><div class="ga-user-name" style="color:#4CAF50;">✅ Account Deleted</div><div class="ga-user-meta">"${escapeHtml(username)}" has been permanently removed.</div></div>`;
        addLog && addLog(`[ADMIN] Deleted account: ${username}`);
        await showAlert(`Account "${username}" has been permanently deleted.`, '✅');
    }

    async function gaBanChat(uid, username, permanent) {
        if (!isGameAdmin) return;
        // Enforce strict hierarchy
        if (!await canActOn(uid)) {
            await showAlert('You do not have permission to ban this account.\nThe admin hierarchy prevents this action.', '🔒');
            return;
        }
        const banData = permanent
            ? { permanent: true, bannedAt: Date.now(), bannedBy: currentUser.username }
            : { permanent: false, until: Date.now() + 24 * 60 * 60 * 1000, bannedAt: Date.now(), bannedBy: currentUser.username };
        if (!await showConfirm(`${permanent ? 'Permanently' : 'Temporarily (24h)'} ban chat for "${username}"?`, '🔇')) return;
        await database.ref(`chatBans/${uid}`).set(banData);
        const banLabel = permanent ? 'permanently' : 'for 24 hours';
        const resEl = document.getElementById('gaResults');
        if (resEl) resEl.innerHTML = `<div class="ga-user-card" style="border-color:rgba(255,107,107,0.5)"><div class="ga-user-name" style="color:#ff6b6b;">🔇 Chat Banned</div><div class="ga-user-meta">"${escapeHtml(username)}" is banned from chat ${banLabel}.</div></div>`;
        loadGaBanList();
        await showAlert(`"${username}" has been chat banned ${banLabel}.`, '🔇');
    }

    async function gaUnbanChat(uid, username) {
        if (!isGameAdmin) return;
        await database.ref(`chatBans/${uid}`).remove();
        const resElU = document.getElementById('gaResults');
        if (resElU) resElU.innerHTML = `<div class="ga-user-card" style="border-color:rgba(76,175,80,0.5)"><div class="ga-user-name" style="color:#4CAF50;">✅ Ban Removed</div><div class="ga-user-meta">"${escapeHtml(username)}" can now chat again.</div></div>`;
        loadGaBanList();
        await showAlert(`Chat ban removed for "${username}".`, '✅');
    }

    async function loadGaBanList() {
        const listEl = document.getElementById('gaBanList');
        if (!listEl || !isGameAdmin) return;
        listEl.innerHTML = '<div class="dm-loading">Loading...</div>';
        const snap = await database.ref('chatBans').once('value');
        if (!snap.exists()) { listEl.innerHTML = '<div class="dm-empty-hint">No active bans.</div>'; return; }
        listEl.innerHTML = '';
        for (const [uid, ban] of Object.entries(snap.val())) {
            const userSnap = await database.ref(`users/${uid}`).once('value');
            const uname = userSnap.exists() ? userSnap.val().username : uid;
            const expired = !ban.permanent && ban.until && ban.until < Date.now();
            if (expired) { await database.ref(`chatBans/${uid}`).remove(); continue; }
            const row = document.createElement('div');
            row.className = 'ga-ban-row';
            row.innerHTML = `<span>${escapeHtml(uname)}</span>
                <span style="opacity:0.6;font-size:0.85em;">${ban.permanent ? 'Permanent' : `Until ${new Date(ban.until).toLocaleString()}`}</span>
                <button class="admin-ok-btn" data-uid="${uid}" data-name="${escapeHtml(uname)}">Unban</button>`;
            row.querySelector('button').addEventListener('click', () => gaUnbanChat(uid, uname));
            listEl.appendChild(row);
        }
        if (!listEl.children.length) listEl.innerHTML = '<div class="dm-empty-hint">No active bans.</div>';
    }

    console.log('🎮 Poker game v4.5 ready!');

    // ═══════════════════════════════════════════════════════════════
    //  ONBOARDING SYSTEM
    // ═══════════════════════════════════════════════════════════════
    function showOnboarding() {
        onboardingStep = 0;
        renderOnboardingStep();
        document.getElementById('onboardingModal').classList.remove('hidden');
    }

    function renderOnboardingStep() {
        const steps = ['ostep0','ostep1','ostep2'];
        const dots  = ['odot0','odot1','odot2'];
        const titles = ['🃏 How to Play Poker', '⚙️ Features & Mechanics', '🎉 Ready to Play!'];
        steps.forEach((id, i) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('active', i === onboardingStep);
        });
        dots.forEach((id, i) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('active', i === onboardingStep);
        });
        const titleEl = document.getElementById('onboardingTitle');
        if (titleEl) titleEl.textContent = titles[onboardingStep] || '🃏 Welcome!';
        const nextBtn = document.getElementById('onboardingNextBtn');
        const skipBtn = document.getElementById('onboardingSkipBtn');
        if (nextBtn) nextBtn.textContent = onboardingStep < steps.length - 1 ? 'Next →' : '🎲 Start Playing!';
        if (skipBtn) {
            // Allow skip only after reading step 0 (rules shown at least once)
            skipBtn.style.display = onboardingStep > 0 ? 'block' : 'none';
        }
    }

    async function completeOnboarding() {
        document.getElementById('onboardingModal').classList.add('hidden');
        // Clear the isNewUser flag in Firebase so onboarding doesn't re-show
        if (currentUser) {
            await database.ref(`users/${currentUser.uid}/isNewUser`).remove().catch(() => {});
        }
    }

    document.getElementById('onboardingNextBtn')?.addEventListener('click', async () => {
        const steps = document.querySelectorAll('.onboarding-step');
        if (onboardingStep < steps.length - 1) {
            onboardingStep++;
            renderOnboardingStep();
        } else {
            await completeOnboarding();
        }
    });
    document.getElementById('onboardingSkipBtn')?.addEventListener('click', async () => {
        await completeOnboarding();
    });

    // Lobby help button reopens onboarding freely (no step lock)
    document.getElementById('lobbyHelpBtn')?.addEventListener('click', () => {
        onboardingStep = 0;
        renderOnboardingStep();
        // Allow skip when opened from lobby (not mandatory)
        const skipBtn = document.getElementById('onboardingSkipBtn');
        if (skipBtn) skipBtn.style.display = 'block';
        document.getElementById('onboardingModal').classList.remove('hidden');
    });

    // ═══════════════════════════════════════════════════════════════
    //  LEADERBOARD SYSTEM
    // ═══════════════════════════════════════════════════════════════
    document.getElementById('lobbyLbBtn')?.addEventListener('click', openLeaderboard);

    document.getElementById('changelogBtn')?.addEventListener('click', () => {
        document.getElementById('changelogModal').classList.remove('hidden');
    });
    document.getElementById('closeChangelogBtn')?.addEventListener('click', () => {
        document.getElementById('changelogModal').classList.add('hidden');
    });
    document.getElementById('changelogModal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('changelogModal'))
            document.getElementById('changelogModal').classList.add('hidden');
    });
    document.getElementById('closeLeaderboardBtn')?.addEventListener('click', () => {
        document.getElementById('leaderboardModal').classList.add('hidden');
    });
    document.getElementById('leaderboardModal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('leaderboardModal'))
            document.getElementById('leaderboardModal').classList.add('hidden');
    });
    document.getElementById('lbTabStreak')?.addEventListener('click', () => switchLbTab('streak'));
    document.getElementById('lbTabRounds')?.addEventListener('click', () => switchLbTab('rounds'));

    function switchLbTab(tab) {
        activeLbTab = tab;
        document.getElementById('lbTabStreak')?.classList.toggle('active', tab === 'streak');
        document.getElementById('lbTabRounds')?.classList.toggle('active', tab === 'rounds');
        renderLeaderboard(tab);
    }

    async function openLeaderboard() {
        document.getElementById('leaderboardModal').classList.remove('hidden');
        activeLbTab = 'streak';
        document.getElementById('lbTabStreak')?.classList.add('active');
        document.getElementById('lbTabRounds')?.classList.remove('active');
        await renderLeaderboard('streak');
    }

    // ── Load lobby mini leaderboards (level + streak) ──────────────
    async function loadLobbyLeaderboards(myUid) {
        const lvlEl    = document.getElementById('lobbyLvlLb');
        const streakEl = document.getElementById('lobbyStreakLb');
        const badgeEl  = document.getElementById('lobbyLevelBadge');
        try {
            const snap = await database.ref('users').once('value');
            if (!snap.exists()) {
                if (lvlEl) lvlEl.innerHTML = '<div class="mini-lb-loading">No data yet.</div>';
                if (streakEl) streakEl.innerHTML = '<div class="mini-lb-loading">No data yet.</div>';
                return;
            }
            const users = snap.val();
            const _today     = new Date().toISOString().slice(0, 10);
            const _yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            // Effective streak: 0 if player hasn't been active today or yesterday
            function effectiveStreak(stats) {
                if (!stats) return 0;
                const last = stats.lastActiveDay || '';
                if (last === _today || last === _yesterday) return stats.streakDays || 0;
                return 0; // streak broken — more than 1 day since last activity
            }
            const entries = Object.entries(users)
                .filter(([, u]) => u.username && u.stats)
                .map(([uid, u]) => ({
                    uid,
                    username:   u.username,
                    streak:     effectiveStreak(u.stats),
                    rounds:     u.stats?.roundsPlayed || 0,
                    roundsWon:  u.stats?.roundsWon   || 0,
                    // FIX 5: level uses combined score (played + wins*bonus)
                    level:  roundsToLevel(calcLevelScore(u.stats))
                }));

            // Update level badge for current user
            if (badgeEl && myUid) {
                const me = entries.find(e => e.uid === myUid);
                if (me) badgeEl.textContent = `Lv ${me.level}`;
            }

            function renderMiniLb(container, sorted, scoreKey) {
                if (!container) return;
                let html = '';
                sorted.slice(0, 8).forEach((e, i) => {
                    const rank = i + 1;
                    const rankDisp = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
                    const isMe = myUid && e.uid === myUid;
                    const score = scoreKey === 'level'
                        ? `Lv ${e.level}`
                        : `${e.streak}🔥`;
                    html += `<div class="mini-lb-row${isMe ? ' me' : ''}">
                        <span class="mini-lb-rank">${rankDisp}</span>
                        <span class="mini-lb-name">${escapeHtml(e.username)}</span>
                        <span class="mini-lb-score">${score}</span>
                    </div>`;
                });
                container.innerHTML = html || '<div class="mini-lb-loading">No data yet.</div>';
            }

            const byLevel  = [...entries].sort((a, b) => b.level - a.level || b.rounds - a.rounds);
            const byStreak = [...entries].sort((a, b) => b.streak - a.streak || b.rounds - a.rounds);
            renderMiniLb(lvlEl, byLevel, 'level');
            renderMiniLb(streakEl, byStreak, 'streak');
        } catch(e) {
            console.error('loadLobbyLeaderboards error:', e);
        }
    }

    // Level system: levelScore = roundsPlayed + (roundsWon * WIN_LEVEL_BONUS)
    // WIN_LEVEL_BONUS=7: win = 8 pts total (1 for playing + 7 bonus); loss = 1 pt.
    // Thresholds scaled so a 50% win-rate player (avg 4.5 pts/round) levels at a
    // satisfying pace, while big winners rise notably faster.
    const LEVEL_THRESHOLDS = [
        0,     // Lv 1
        10,    // Lv 2   (10 score)
        28,    // Lv 3   (18 more)
        55,    // Lv 4   (27 more)
        90,    // Lv 5   (35 more)
        140,   // Lv 6   (50 more)
        210,   // Lv 7   (70 more)
        310,   // Lv 8   (100 more)
        445,   // Lv 9   (135 more)
        625,   // Lv 10  (180 more)
        890,   // Lv 11  (265 more)
        1250,  // Lv 12  (360 more)
        1780,  // Lv 13  (530 more)
        2490,  // Lv 14  (710 more)
        3500,  // Lv 15  (1010 more)
    ];
    // Compute the combined level score from stats
    function calcLevelScore(stats) {
        const played = stats?.roundsPlayed || 0;
        const won    = stats?.roundsWon    || 0;
        // WIN_LEVEL_BONUS=7: each win gives +7 extra score on top of +1 for playing = 8 total
        return played + won * WIN_LEVEL_BONUS;
    }
    function roundsToLevel(rounds) {
        // rounds here is the levelScore (not raw roundsPlayed)
        let lvl = 1;
        for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
            if (rounds >= LEVEL_THRESHOLDS[i]) lvl = i + 1;
            else break;
        }
        return lvl;
    }
    function levelProgress(rounds) {
        const lvl = roundsToLevel(rounds);
        const curThresh = LEVEL_THRESHOLDS[lvl - 1] || 0;
        const nextThresh = LEVEL_THRESHOLDS[lvl]; // undefined if max level
        if (!nextThresh) return { lvl, pct: 100, cur: rounds - curThresh, needed: 0 };
        const cur = rounds - curThresh;
        const needed = nextThresh - curThresh;
        return { lvl, pct: Math.round(cur / needed * 100), cur, needed };
    }

    async function renderLeaderboard(type) {
        const container = document.getElementById('lbContent');
        if (!container) return;
        container.innerHTML = '<div class="lb-loading"><span class="lb-spinner"></span>Loading leaderboard…</div>';
        try {
            const snap = await database.ref('users').once('value');
            if (!snap.exists()) { container.innerHTML = '<div class="lb-loading">No data yet.</div>'; return; }
            const users = snap.val();
            // Build entries — streak is 0 if not active today or yesterday
            const _lbToday     = new Date().toISOString().slice(0, 10);
            const _lbYesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            function lbEffectiveStreak(stats) {
                if (!stats) return 0;
                const last = stats.lastActiveDay || '';
                return (last === _lbToday || last === _lbYesterday) ? (stats.streakDays || 0) : 0;
            }
            const entries = Object.entries(users)
                .filter(([, u]) => u.username && u.stats)
                .map(([uid, u]) => ({
                    uid,
                    username:  u.username,
                    streak:    lbEffectiveStreak(u.stats),
                    rounds:    u.stats?.roundsPlayed || 0,
                    roundsWon: u.stats?.roundsWon   || 0,
                    // FIX 5: level uses combined score (played + wins*bonus)
                    level:     roundsToLevel(calcLevelScore(u.stats))
                }));

            if (entries.length === 0) { container.innerHTML = '<div class="lb-loading">No stats yet — play a round!</div>'; return; }

            const sorted = [...entries].sort((a, b) => {
                if (type === 'streak') return b.streak - a.streak || b.rounds - a.rounds;
                return b.level - a.level || b.rounds - a.rounds; // sort by level, then rounds as tiebreak
            });

            let html = '<div class="lb-table">';
            sorted.slice(0, 20).forEach((entry, i) => {
                const rank = i + 1;
                const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
                const rankDisplay = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
                const isMe = currentUser && entry.uid === currentUser.uid;
                const score = type === 'streak'
                    ? `${entry.streak} <span class="lb-sub">day${entry.streak !== 1 ? 's' : ''}</span>`
                    : `Lv ${entry.level} <span class="lb-sub">(${entry.rounds} rounds)</span>`;
                html += `<div class="lb-row ${isMe ? 'me' : ''}">
                    <div class="lb-rank ${rankClass}">${rankDisplay}</div>
                    <div class="lb-name">${escapeHtml(entry.username)}${isMe ? ' <span style="color:#4CAF50;font-size:0.75em;">(you)</span>' : ''}</div>
                    <div class="lb-score">${score}</div>
                </div>`;
            });
            html += '</div>';

            // Show my rank if I'm not in top 20
            if (currentUser) {
                const myIdx = sorted.findIndex(e => e.uid === currentUser.uid);
                if (myIdx >= 20) {
                    const me = sorted[myIdx];
                    const score = type === 'streak' ? `${me.streak} days` : `Lv ${me.level}`;
                    html += `<div style="text-align:center;margin-top:8px;font-size:0.82em;opacity:0.6;">Your rank: #${myIdx + 1} (${score})</div>`;
                }
            }

            container.innerHTML = html;
        } catch(e) {
            container.innerHTML = '<div class="lb-loading">Error loading leaderboard.</div>';
            console.error('Leaderboard error:', e);
        }
    }

    // ── Update streak on login ────────────────────────────────────
    async function updateLoginStreak(uid) {
        if (currentUser?.isGuest) return;
        try {
            const snap = await database.ref(`users/${uid}/stats`).once('value');
            const stats = snap.val() || { roundsPlayed: 0, lastActiveDay: '', streakDays: 0 };
            const today     = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
            const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

            if (stats.lastActiveDay === today) {
                // Already counted today — but if stored streak is stale, reset it
                // (handles edge case where streak was written as stale from a previous session)
                return;
            }

            // If last active day was yesterday, continue streak; otherwise reset to 1
            const newStreak = (stats.lastActiveDay === yesterday)
                ? (stats.streakDays || 0) + 1
                : 1; // broken — more than 1 day gap, start fresh

            await database.ref(`users/${uid}/stats`).update({
                lastActiveDay: today,
                streakDays: newStreak
            });
        } catch(e) { /* silent */ }
    }

    // ── Record a round played ────────────────────────────────────
    async function recordRoundPlayed() {
        if (!currentUser || currentUser.isGuest) return;
        try {
            const snap = await database.ref(`users/${currentUser.uid}/stats/roundsPlayed`).once('value');
            const cur = snap.val() || 0;
            await database.ref(`users/${currentUser.uid}/stats/roundsPlayed`).set(cur + 1);
            // Also count as activity for streak purposes
            await updateLoginStreak(currentUser.uid);
        } catch(e) { /* silent */ }
    }

    // Record a round won — wins give a much larger level bonus than losses.
    // Each win adds WIN_LEVEL_BONUS extra points on top of the 1 point for playing.
    const WIN_LEVEL_BONUS = 7; // each win = +7 bonus score (+ 1 for playing = 8 total vs 1 for a loss)

    // recordRoundWon(winnerUsername) — called with the winner's username string directly
    // (not their playerId) so we never need to look up stale gameState.
    // Each client only increments for itself: if winnerUsername !== currentUser.uid, skip.
    async function recordRoundWon(winnerUsername) {
        if (!currentUser || currentUser.isGuest) return;
        if (!winnerUsername) return;
        // currentUser.uid === username.toLowerCase() in this app's auth
        if (winnerUsername.toLowerCase() !== currentUser.uid) return;
        try {
            const snap = await database.ref(`users/${currentUser.uid}/stats/roundsWon`).once('value');
            const cur = snap.val() || 0;
            await database.ref(`users/${currentUser.uid}/stats/roundsWon`).set(cur + 1);
        } catch(e) { /* silent */ }
    }

    // ═══════════════════════════════════════════════════════════════
    //  SIT-OUT MODE  (manual, round-boundary safe)
    // ═══════════════════════════════════════════════════════════════
    // Player State Machine:
    //   ACTIVE      — playing normally
    //   SIT_OUT_PENDING — requested sit-out; takes effect after hand ends / after folding
    //   SITTING_OUT — excluded from deal/turn order; can watch
    //   OBSERVER    — no chips left; watches only
    //   DISCONNECTED — leftAt set; in rejoin window
    //
    // Transitions enforced:
    //   ACTIVE → SIT_OUT_PENDING (via button press)
    //   SIT_OUT_PENDING → SITTING_OUT (after fold or hand end)
    //   SITTING_OUT → ACTIVE (via "Return to Game" — takes effect next hand)
    //   ACTIVE → DISCONNECTED (tab close / onDisconnect)
    //   DISCONNECTED → ACTIVE (rejoin within window)

    document.getElementById('sitOutBtn')?.addEventListener('click', async () => {
        if (!gameId || !playerId) return;
        const cur = gameState?.players?.[playerId];
        if (!cur) return;

        if (cur.sittingOut) {
            // Already sitting out — this is a "cancel sit-out" action
            await database.ref(`games/${gameId}/players/${playerId}/sittingOut`).set(false);
            await database.ref(`games/${gameId}/players/${playerId}/sitOutPending`).set(false);
            isSittingOutPending = false;
            showToast('✅ You will re-join from the next hand.');
            updateSitOutBtn();
            return;
        }

        if (isSittingOutPending || cur.sitOutPending) {
            // Cancel pending sit-out
            await database.ref(`games/${gameId}/players/${playerId}/sitOutPending`).set(false);
            isSittingOutPending = false;
            showToast('❌ Sit-out cancelled.');
            updateSitOutBtn();
            return;
        }

        // If it's currently my turn OR I've folded already, apply immediately
        if (isMyTurn() || cur.folded) {
            await database.ref(`games/${gameId}/players/${playerId}`).update({
                sittingOut: true,
                sitOutPending: false
            });
            isSittingOutPending = false;
            addLog(`💤 ${playerName} is sitting out.`);
            updateSitOutBtn();
            return;
        }

        // Mid-round, not my turn — mark pending; takes effect after fold or hand end
        await database.ref(`games/${gameId}/players/${playerId}/sitOutPending`).set(true);
        isSittingOutPending = true;
        showToast('💤 You will sit out after this hand (or after you fold).');
        updateSitOutBtn();
    });

    function updateSitOutBtn() {
        const btn = document.getElementById('sitOutBtn');
        if (!btn || !gameState || !playerId) return;
        const cur = gameState?.players?.[playerId];
        if (!cur) {
            btn.textContent = '💤 Sit Out Next Hand';
            btn.className = 'sitout-toggle-btn';
            return;
        }
        if (cur.sittingOut) {
            btn.textContent = '☀️ Return to Game (next hand)';
            btn.className = 'sitout-toggle-btn';
            btn.style.background = 'rgba(76,175,80,0.2)';
            btn.style.borderColor = 'rgba(76,175,80,0.4)';
            btn.style.color = '#81c784';
        } else if (isSittingOutPending || cur.sitOutPending) {
            btn.textContent = '❌ Cancel Sit-Out Request';
            btn.className = 'sitout-toggle-btn pending';
        } else {
            btn.textContent = '💤 Sit Out Next Hand';
            btn.className = 'sitout-toggle-btn';
            btn.style.background = '';
            btn.style.borderColor = '';
            btn.style.color = '';
        }
    }

    function showToast(msg) {
        const existing = document.querySelector('.sitout-pending-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'sitout-pending-toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  BLACKJACK ENGINE
    //  Rules: standard casino blackjack vs dealer
    //  - Players bet before each hand
    //  - Dealer hits on soft 16, stands on soft 17
    //  - Blackjack pays 3:2
    //  - Double down available on first two cards
    //  - No splitting (keep it simple for multiplayer)
    //  - Turn order: each player acts in sequence; dealer resolves last
    // ═══════════════════════════════════════════════════════════════════

    const BJ_BET_SECONDS  = 20; // time to place bet
    const BJ_TURN_SECONDS = 20; // time per player turn
    const BJ_MIN_BET = 5;
    const BJ_MAX_BET = 500;

    // ── BJ state (local mirrors) ─────────────────────────────────────
    let bjTimerInterval    = null;
    let bjTimerDeadline    = 0;
    let bjBetTimerInterval = null;
    let bjBetTimerActive   = false;
    let bjActionSubmitting = false;

    // ── BJ helpers ───────────────────────────────────────────────────
    function bjCardValue(card) {
        if (!card) return 0;
        const r = card.rank;
        if (['J','Q','K'].includes(r)) return 10;
        if (r === 'A') return 11; // raw; bjHandTotal handles soft/hard
        return parseInt(r) || 0;
    }

    function bjHandTotal(cards) {
        if (!cards || cards.length === 0) return 0;
        let total = 0, aces = 0;
        for (const c of cards) {
            const v = bjCardValue(c);
            if (c.rank === 'A') aces++;
            total += v;
        }
        while (total > 21 && aces > 0) { total -= 10; aces--; }
        return total;
    }

    function bjIsSoft(cards) {
        // True if the hand contains an Ace still counted as 11 (not reduced to 1)
        let total = 0, aces = 0;
        for (const c of cards) { const v = bjCardValue(c); if (c.rank === 'A') aces++; total += v; }
        // Replicate the same reduction logic as bjHandTotal
        while (total > 21 && aces > 0) { total -= 10; aces--; }
        // If aces > 0 after reduction, at least one ace is still counting as 11
        return aces > 0 && total <= 21;
    }

    function bjIsBlackjack(cards) {
        return cards && cards.length === 2 && bjHandTotal(cards) === 21;
    }

    function bjHandLabel(cards) {
        if (!cards || cards.length === 0) return '';
        const t = bjHandTotal(cards);
        if (bjIsBlackjack(cards)) return 'Blackjack! 🌟';
        if (t > 21) return `Bust (${t}) 💀`;
        if (bjIsSoft(cards) && cards.some(c => c.rank === 'A')) return `Soft ${t}`;
        return String(t);
    }

    // Draw N cards from deck starting at deckIndex
    function bjDraw(deck, deckIndex, n) {
        const drawn = [];
        let di = deckIndex;
        for (let i = 0; i < n; i++) {
            if (di < deck.length) drawn.push(deck[di++]);
        }
        return { cards: drawn, newIndex: di };
    }

    // ── BJ: Start a new hand ─────────────────────────────────────────
    async function bjStartHand() {
        if (!gameId) return;
        const snap = await database.ref(`games/${gameId}`).once('value');
        const state = snap.val();
        if (!state || state.gameType !== 'blackjack') return;
        // Transaction lock — only one client starts the hand
        let won = false;
        await database.ref(`games/${gameId}/status`).transaction(cur => {
            if (cur === 'waiting' || cur === 'bjBetting') { won = true; return 'bjDealing'; }
            return undefined;
        });
        if (!won) return;

        const players = state.players || {};
        const activePids = Object.keys(players).filter(id =>
            players[id].chips > 0 && !players[id].sittingOut &&
            !players[id].spectating && !players[id].pendingAdmit &&
            !players[id].observer && !players[id].leftAt
        );
        if (activePids.length < 1) {
            await database.ref(`games/${gameId}/status`).set('waiting');
            return;
        }

        const deck = createDeck();
        // Deal 2 cards to each player + 2 to dealer (one dealer card hidden)
        let di = 0;
        const upd = {};
        upd[`games/${gameId}/status`]       = 'bjBetting';
        upd[`games/${gameId}/gameStarted`]  = true;
        upd[`games/${gameId}/bjDeck`]       = deck;
        upd[`games/${gameId}/bjDeckIndex`]  = 0;
        upd[`games/${gameId}/bjDealerCards`] = [];
        upd[`games/${gameId}/bjDealerDone`] = false;
        upd[`games/${gameId}/bjPhase`]      = 'betting'; // 'betting' | 'playing' | 'dealer' | 'results'
        upd[`games/${gameId}/bjCurrentTurn`] = null;
        upd[`games/${gameId}/bjTurnTimestamp`] = null;
        upd[`games/${gameId}/bjBetDeadline`]   = Date.now() + BJ_BET_SECONDS * 1000;
        upd[`games/${gameId}/roundWinner`]     = null;
        upd[`games/${gameId}/lastActivity`]    = Date.now();
        // Reset player hands and bets
        for (const id of Object.keys(players)) {
            upd[`games/${gameId}/players/${id}/bjCards`]       = [];
            upd[`games/${gameId}/players/${id}/bjBet`]         = 0;
            upd[`games/${gameId}/players/${id}/bjResult`]      = null;
            upd[`games/${gameId}/players/${id}/bjDone`]        = false;
            upd[`games/${gameId}/players/${id}/bjDoubled`]     = false;
            upd[`games/${gameId}/players/${id}/bjSplitCards`]  = null;
            upd[`games/${gameId}/players/${id}/bjSplitBet`]    = 0;
            upd[`games/${gameId}/players/${id}/bjSplitDone`]   = false;
            upd[`games/${gameId}/players/${id}/bjSplitResult`] = null;
            upd[`games/${gameId}/players/${id}/bjSplitPayout`] = null;
            upd[`games/${gameId}/players/${id}/bjOnSplitHand`] = false;
            upd[`games/${gameId}/players/${id}/bjSittingOut`]  = !activePids.includes(id);
        }
        await database.ref().update(upd);
        addLog('♠️ New Blackjack hand — place your bets!');
    }

    // ── BJ: Deal cards after betting phase ends ──────────────────────
    async function bjDealCards() {
        const snap = await database.ref(`games/${gameId}`).once('value');
        const state = snap.val();
        if (!state || state.bjPhase !== 'betting') return;
        let won = false;
        await database.ref(`games/${gameId}/bjPhase`).transaction(cur => {
            if (cur === 'betting') { won = true; return 'dealing'; }
            return undefined;
        });
        if (!won) return;

        const deck    = state.bjDeck;
        let di        = state.bjDeckIndex || 0;
        const players = state.players || {};
        const activePids = Object.keys(players).filter(id =>
            players[id].bjBet > 0 && !players[id].bjSittingOut &&
            !players[id].spectating && !players[id].pendingAdmit && !players[id].leftAt
        );

        if (activePids.length === 0) {
            // No bets placed — full reset so next hand starts cleanly
            addLog('No bets placed — skipping to next hand...');
            const noBetUpd = {};
            noBetUpd[`games/${gameId}/bjPhase`]       = 'idle';
            noBetUpd[`games/${gameId}/status`]         = 'waiting';
            noBetUpd[`games/${gameId}/bjBetDeadline`]  = null;
            noBetUpd[`games/${gameId}/bjCurrentTurn`]  = null;
            noBetUpd[`games/${gameId}/bjDealerCards`]  = [];
            noBetUpd[`games/${gameId}/bjDealerHidden`] = null;
            noBetUpd[`games/${gameId}/bjTurnOrder`]    = null;
            noBetUpd[`games/${gameId}/bjTurnIndex`]    = 0;
            noBetUpd[`games/${gameId}/lastActivity`]   = Date.now();
            for (const id of Object.keys(players)) {
                noBetUpd[`games/${gameId}/players/${id}/bjCards`]       = [];
                noBetUpd[`games/${gameId}/players/${id}/bjBet`]         = 0;
                noBetUpd[`games/${gameId}/players/${id}/bjResult`]      = null;
                noBetUpd[`games/${gameId}/players/${id}/bjDone`]        = false;
                noBetUpd[`games/${gameId}/players/${id}/bjSittingOut`]  = false;
                noBetUpd[`games/${gameId}/players/${id}/bjSplitCards`]  = null;
                noBetUpd[`games/${gameId}/players/${id}/bjSplitBet`]    = 0;
                noBetUpd[`games/${gameId}/players/${id}/bjSplitDone`]   = false;
                noBetUpd[`games/${gameId}/players/${id}/bjSplitResult`] = null;
                noBetUpd[`games/${gameId}/players/${id}/bjOnSplitHand`] = false;
            }
            await database.ref().update(noBetUpd);
            return;
        }

        const upd = {};
        // Deal 2 cards to each active player
        for (const id of activePids) {
            const { cards, newIndex } = bjDraw(deck, di, 2);
            di = newIndex;
            upd[`games/${gameId}/players/${id}/bjCards`] = cards;
        }
        // Deal 2 to dealer (second card hidden — not sent to clients yet)
        const { cards: dealerCards, newIndex: di2 } = bjDraw(deck, di, 2);
        di = di2;
        // Only send first dealer card publicly; hide second
        upd[`games/${gameId}/bjDealerCards`]    = [dealerCards[0]]; // visible
        upd[`games/${gameId}/bjDealerHidden`]   = dealerCards[1];   // hidden hole card
        upd[`games/${gameId}/bjDeckIndex`]      = di;
        upd[`games/${gameId}/bjPhase`]          = 'playing';
        upd[`games/${gameId}/status`]           = 'playing';
        upd[`games/${gameId}/bjCurrentTurn`]    = activePids[0];
        upd[`games/${gameId}/bjTurnTimestamp`]  = Date.now();
        upd[`games/${gameId}/bjTurnOrder`]      = activePids;
        upd[`games/${gameId}/bjTurnIndex`]      = 0;
        upd[`games/${gameId}/lastActivity`]     = Date.now();
        await database.ref().update(upd);

        // Auto-resolve any instant blackjacks
        for (const id of activePids) {
            const pCards = upd[`games/${gameId}/players/${id}/bjCards`];
            if (bjIsBlackjack(pCards)) {
                await database.ref(`games/${gameId}/players/${id}/bjDone`).set(true);
                addLog(`🌟 ${players[id].name} has Blackjack!`);
            }
        }
        addLog('Cards dealt! Player turns begin.');
        // Advance past any instant BJ players at the start.
        // fromDeal=true so we scan from index 0 — player 0 is never skipped.
        // Re-read fresh state so bjTurnOrder (just written above) is visible.
        const freshDealSnap = await database.ref(`games/${gameId}`).once('value');
        await bjAdvanceTurn(freshDealSnap.val(), true);
    }

    // ── BJ: Advance turn to next player ─────────────────────────────
    // fromDeal=true: scan from index 0 to find the first undone player (post-deal)
    // fromDeal=false (default): advance past current player (index+1) on normal action
    async function bjAdvanceTurn(freshStateHint, fromDeal = false) {
        const snap  = await database.ref(`games/${gameId}`).once('value');
        const state = snap.val();
        if (!state || state.bjPhase !== 'playing') return;

        const order   = state.bjTurnOrder || [];
        const players = state.players || {};

        // A player is done when their main hand is done AND split hand is done (if exists).
        function bjPlayerFullyDone(p) {
            if (!p?.bjDone) return false;
            if (p.bjSplitCards && !p.bjSplitDone) return false;
            return true;
        }
        let nextIdx = fromDeal ? 0 : (state.bjTurnIndex || 0) + 1;
        while (nextIdx < order.length) {
            const pid = order[nextIdx];
            if (!bjPlayerFullyDone(players[pid])) break;
            nextIdx++;
        }

        if (nextIdx >= order.length) {
            // All players done — dealer's turn
            // Write phase=dealer first, then immediately run dealer on admin client.
            // Use a transaction so only ONE client wins the write and runs the dealer.
            let allDoneWon = false;
            await database.ref(`games/${gameId}/bjPhase`).transaction(cur => {
                if (cur === 'playing') { allDoneWon = true; return 'dealer'; }
                return undefined;
            });
            if (allDoneWon) {
                // We won the write — also stamp the other fields
                await database.ref(`games/${gameId}`).update({
                    bjCurrentTurn: 'dealer',
                    bjTurnTimestamp: Date.now(),
                    lastActivity: Date.now()
                });
                // Run dealer immediately — we already own the 'dealer' phase
                await bjRunDealerDirect();
            }
        } else {
            await database.ref(`games/${gameId}`).update({
                bjCurrentTurn: order[nextIdx],
                bjTurnIndex: nextIdx,
                bjTurnTimestamp: Date.now(),
                lastActivity: Date.now()
            });
        }
    }

    // ── BJ: Dealer resolves hand ─────────────────────────────────────
    // bjRunDealer: called by external clients that see bjPhase='dealer' in Firebase.
    // Uses a transaction to claim 'dealerRunning'.
    async function bjRunDealer() {
        let dealerWon = false;
        await database.ref(`games/${gameId}/bjPhase`).transaction(cur => {
            if (cur === 'dealer') { dealerWon = true; return 'dealerRunning'; }
            return undefined;
        });
        if (!dealerWon) return;
        await bjRunDealerDirect();
    }

    // bjRunDealerDirect: called when this client already owns the dealer turn
    // (phase already set to 'dealer' or 'dealerRunning' by this client).
    async function bjRunDealerDirect() {
        // Mark as running to block other clients
        await database.ref(`games/${gameId}/bjPhase`).set('dealerRunning');

        const snap = await database.ref(`games/${gameId}`).once('value');
        const state = snap.val();
        if (!state) return;

        const deck      = state.bjDeck;
        let di          = state.bjDeckIndex || 0;
        const hidden    = state.bjDealerHidden;
        let dealerCards = [...(state.bjDealerCards || [])];

        // Reveal hole card
        if (hidden) dealerCards.push(hidden);

        // Dealer hits on soft 17 or below (standard Vegas H17 rules — more balanced)
        // This means dealer hits A+6 (soft 17) and any hard 16 or below.
        while (true) {
            const total = bjHandTotal(dealerCards);
            if (total > 21) break; // bust
            if (total > 17) break; // hard 18+ → stand
            if (total === 17 && !bjIsSoft(dealerCards)) break; // hard 17 → stand
            // soft 17 or below → hit
            const { cards, newIndex } = bjDraw(deck, di, 1);
            di = newIndex;
            dealerCards.push(cards[0]);
        }

        const dealerTotal = bjHandTotal(dealerCards);
        const dealerBust  = dealerTotal > 21;
        const dealerBJ    = bjIsBlackjack(dealerCards);

        // Resolve each player
        const players = state.players || {};
        const upd     = {};
        let logParts  = [];

        // Helper: resolve one hand vs dealer
        function bjResolveHand(cards, bet, isSplitHand) {
            const playerTotal = bjHandTotal(cards);
            const playerBJ    = !isSplitHand && bjIsBlackjack(cards); // no BJ bonus on split hand (standard rule)
            let result, payout;
            if (playerTotal > 21) {
                result = 'bust'; payout = 0;
            } else if (playerBJ && !dealerBJ) {
                result = 'blackjack'; payout = bet + Math.floor(bet * 1.5);
            } else if (playerBJ && dealerBJ) {
                result = 'push'; payout = bet;
            } else if (dealerBJ) {
                result = 'lose'; payout = 0;
            } else if (dealerBust) {
                result = 'win'; payout = bet * 2;
            } else if (playerTotal > dealerTotal) {
                result = 'win'; payout = bet * 2;
            } else if (playerTotal === dealerTotal) {
                // Ties go to the dealer (house edge) — only BJ vs BJ is a push (handled above)
                result = 'lose'; payout = 0;
            } else {
                result = 'lose'; payout = 0;
            }
            return { result, payout, playerTotal };
        }

        for (const [id, p] of Object.entries(players)) {
            if (p.bjSittingOut || p.bjBet <= 0 || !p.bjCards?.length) continue;

            // Resolve primary hand
            const { result, payout, playerTotal } = bjResolveHand(p.bjCards, p.bjBet, false);
            let totalPayout = payout;

            upd[`games/${gameId}/players/${id}/bjResult`]  = result;
            upd[`games/${gameId}/players/${id}/bjPayout`]  = payout;

            const emoji = result === 'blackjack' ? '🌟' : result === 'win' ? '✅' : result === 'push' ? '🤝' : result === 'bust' ? '💀' : '❌';
            let logStr = `${p.name}: ${emoji} ${result} (${playerTotal} vs ${dealerBust ? 'bust' : dealerTotal})`;

            // Resolve split hand if it exists
            if (p.bjSplitCards?.length && p.bjSplitBet > 0) {
                const { result: sr, payout: sp, playerTotal: st2 } = bjResolveHand(p.bjSplitCards, p.bjSplitBet, true);
                upd[`games/${gameId}/players/${id}/bjSplitResult`]  = sr;
                upd[`games/${gameId}/players/${id}/bjSplitPayout`]  = sp;
                totalPayout += sp;
                const se = sr === 'win' ? '✅' : sr === 'push' ? '🤝' : sr === 'bust' ? '💀' : '❌';
                logStr += ` | Split: ${se} ${sr} (${st2})`;
                if (sr === 'win') recordRoundWon(p.username || p.name).catch(() => {});
            }

            upd[`games/${gameId}/players/${id}/chips`] = p.chips + totalPayout;

            logParts.push(logStr);

            if (result === 'win' || result === 'blackjack') {
                recordRoundWon(p.username || p.name).catch(() => {});
            }
        }

        upd[`games/${gameId}/bjDealerCards`]  = dealerCards;
        upd[`games/${gameId}/bjDealerHidden`] = null;
        upd[`games/${gameId}/bjDeckIndex`]    = di;
        upd[`games/${gameId}/bjPhase`]        = 'results';
        upd[`games/${gameId}/bjCurrentTurn`]  = null;
        upd[`games/${gameId}/lastActivity`]   = Date.now();

        await database.ref().update(upd);
        recordRoundPlayed();

        const dealerLabel = dealerBJ ? 'Blackjack!' : dealerBust ? `Bust (${dealerTotal})` : String(dealerTotal);
        addLog(`Dealer: ${dealerLabel} | ${logParts.join(' | ')}`);

        // Show results for 5s then reset
        setTimeout(() => bjReset(), 5000);
    }

    // ── BJ: Reset for next hand ──────────────────────────────────────
    async function bjReset() {
        if (!gameId) return;
        const snap = await database.ref(`games/${gameId}`).once('value');
        const state = snap.val();
        if (!state || state.gameType !== 'blackjack') return;
        // Only admin resets
        if (state.adminId !== playerId && !isGameAdmin) return;

        const players = state.players || {};
        const upd = {};
        // Game over check
        const withChips = Object.entries(players).filter(([,p]) =>
            p.chips > 0 && !p.spectating && !p.pendingAdmit && !p.leftAt);
        if (withChips.length === 0) {
            upd[`games/${gameId}/status`]  = 'gameover';
            upd[`games/${gameId}/bjPhase`] = 'idle';
            await database.ref().update(upd);
            return;
        }

        upd[`games/${gameId}/status`]          = 'waiting';
        upd[`games/${gameId}/bjPhase`]         = 'idle';
        upd[`games/${gameId}/bjDealerCards`]   = [];
        upd[`games/${gameId}/bjDealerHidden`]  = null;
        upd[`games/${gameId}/bjCurrentTurn`]   = null;
        upd[`games/${gameId}/bjTurnTimestamp`] = null;
        upd[`games/${gameId}/bjTurnOrder`]     = null;
        upd[`games/${gameId}/bjTurnIndex`]     = 0;
        upd[`games/${gameId}/bjBetDeadline`]   = null;
        upd[`games/${gameId}/roundWinner`]     = null;
        upd[`games/${gameId}/lastActivity`]    = Date.now();

        for (const [id, p] of Object.entries(players)) {
            if (p.spectating || p.pendingAdmit) continue;
            upd[`games/${gameId}/players/${id}/bjCards`]       = [];
            upd[`games/${gameId}/players/${id}/bjBet`]         = 0;
            upd[`games/${gameId}/players/${id}/bjResult`]      = null;
            upd[`games/${gameId}/players/${id}/bjPayout`]      = null;
            upd[`games/${gameId}/players/${id}/bjDone`]        = false;
            upd[`games/${gameId}/players/${id}/bjDoubled`]     = false;
            upd[`games/${gameId}/players/${id}/bjSplitCards`]  = null;
            upd[`games/${gameId}/players/${id}/bjSplitBet`]    = 0;
            upd[`games/${gameId}/players/${id}/bjSplitDone`]   = false;
            upd[`games/${gameId}/players/${id}/bjSplitResult`] = null;
            upd[`games/${gameId}/players/${id}/bjSplitPayout`] = null;
            upd[`games/${gameId}/players/${id}/bjOnSplitHand`] = false;
            upd[`games/${gameId}/players/${id}/bjSittingOut`]  = p.chips <= 0;
            // FIX: admitted players activate at hand boundary same as poker
            if (p.admittedNextHand || p.admittedNextHand2) {
                upd[`games/${gameId}/players/${id}/admittedNextHand`]  = false;
                upd[`games/${gameId}/players/${id}/admittedNextHand2`] = false;
                upd[`games/${gameId}/players/${id}/sittingOut`]        = false;
                upd[`games/${gameId}/players/${id}/observer`]          = false;
                upd[`games/${gameId}/players/${id}/spectating`]        = false;
                upd[`games/${gameId}/players/${id}/pendingAdmit`]      = false;
                upd[`games/${gameId}/players/${id}/sitOutReason`]      = null;
            }
        }
        await database.ref().update(upd);
        addLog('Next hand in 3 seconds...');
        // Auto-start next hand
        setTimeout(async () => {
            const chk = await database.ref(`games/${gameId}`).once('value');
            const cs  = chk.val();
            if (!cs || cs.gameType !== 'blackjack') return;
            if (cs.adminId !== playerId && !isGameAdmin) return;
            await bjStartHand();
        }, 3000);
    }

    // ── BJ: Player actions ───────────────────────────────────────────
    async function bjPlaceBet() {
        if (bjActionSubmitting) return;
        if (!gameState || gameState.bjPhase !== 'betting') return;
        const slider = document.getElementById('bjBetSlider');
        const myChips = gameState.players?.[playerId]?.chips || 0;
        const maxBetAllowed = Math.max(BJ_MIN_BET, Math.floor(myChips / 2));
        const betAmt = Math.max(BJ_MIN_BET, Math.min(maxBetAllowed, parseInt(slider?.value) || BJ_MIN_BET));
        if (betAmt > myChips) { showToast('Not enough chips!'); return; }

        bjActionSubmitting = true;
        try {
            await database.ref(`games/${gameId}/players/${playerId}`).update({
                bjBet: betAmt,
                chips: myChips - betAmt
            });
            addLog(`${playerName} bets $${betAmt}`);
            // If all active players have bet, deal immediately.
            // Any player (not just admin) can trigger this — the bjDealCards function
            // uses a Firebase transaction to ensure only one client actually deals.
            const snap = await database.ref(`games/${gameId}`).once('value');
            const st   = snap.val();
            if (!st) return;
            // Include players who are active OR who placed a bet (chips may be 0 after betting all-in)
            const active = Object.entries(st.players || {}).filter(([,p]) =>
                !p.bjSittingOut && !p.spectating && !p.pendingAdmit && !p.leftAt &&
                (p.chips > 0 || p.bjBet > 0));
            const allBet = active.length > 0 && active.every(([,p]) => p.bjBet > 0);
            if (allBet) {
                await bjDealCards();
            }
        } finally {
            bjActionSubmitting = false;
        }
    }

    async function bjSkipRound() {
        await database.ref(`games/${gameId}/players/${playerId}`).update({ bjSittingOut: true, bjBet: 0 });
        addLog(`${playerName} sits out this hand.`);
        // After skipping, check remaining active players
        const snap = await database.ref(`games/${gameId}`).once('value');
        const st   = snap.val();
        if (!st || st.bjPhase !== 'betting') return;
        const active = Object.entries(st.players || {}).filter(([,p]) =>
            !p.bjSittingOut && !p.spectating && !p.pendingAdmit && !p.leftAt &&
            (p.chips > 0 || p.bjBet > 0));
        if (active.length === 0) {
            // Everyone skipped — full reset so next hand starts cleanly
            addLog('Everyone skipped — restarting hand...');
            const allSkipUpd = {};
            allSkipUpd[`games/${gameId}/bjPhase`]       = 'idle';
            allSkipUpd[`games/${gameId}/status`]         = 'waiting';
            allSkipUpd[`games/${gameId}/bjBetDeadline`]  = null;
            allSkipUpd[`games/${gameId}/bjCurrentTurn`]  = null;
            allSkipUpd[`games/${gameId}/bjDealerCards`]  = [];
            allSkipUpd[`games/${gameId}/bjDealerHidden`] = null;
            allSkipUpd[`games/${gameId}/bjTurnOrder`]    = null;
            allSkipUpd[`games/${gameId}/bjTurnIndex`]    = 0;
            allSkipUpd[`games/${gameId}/lastActivity`]   = Date.now();
            const allPlayers = st.players || {};
            for (const id of Object.keys(allPlayers)) {
                allSkipUpd[`games/${gameId}/players/${id}/bjCards`]       = [];
                allSkipUpd[`games/${gameId}/players/${id}/bjBet`]         = 0;
                allSkipUpd[`games/${gameId}/players/${id}/bjResult`]      = null;
                allSkipUpd[`games/${gameId}/players/${id}/bjDone`]        = false;
                allSkipUpd[`games/${gameId}/players/${id}/bjSittingOut`]  = false;
                allSkipUpd[`games/${gameId}/players/${id}/bjSplitCards`]  = null;
                allSkipUpd[`games/${gameId}/players/${id}/bjSplitBet`]    = 0;
                allSkipUpd[`games/${gameId}/players/${id}/bjSplitDone`]   = false;
                allSkipUpd[`games/${gameId}/players/${id}/bjSplitResult`] = null;
                allSkipUpd[`games/${gameId}/players/${id}/bjOnSplitHand`] = false;
            }
            await database.ref().update(allSkipUpd);
            return;
        }
        if (active.every(([,p]) => p.bjBet > 0)) {
            await bjDealCards();
        }
    }

    async function bjHit() {
        if (bjActionSubmitting) return;
        const st = gameState;
        if (!st || st.bjCurrentTurn !== playerId || st.bjPhase !== 'playing') return;
        bjActionSubmitting = true;
        bjStopTimer();
        try {
            const snap = await database.ref(`games/${gameId}`).once('value');
            const state = snap.val();
            if (!state || state.bjCurrentTurn !== playerId) return;
            const onSplit = state.players[playerId]?.bjOnSplitHand || false;
            const deck = state.bjDeck;
            const di   = state.bjDeckIndex || 0;
            const { cards, newIndex } = bjDraw(deck, di, 1);
            const cardKey = onSplit ? 'bjSplitCards' : 'bjCards';
            const myCards = [...(state.players[playerId]?.[cardKey] || []), ...cards];
            const total   = bjHandTotal(myCards);
            const upd     = {};
            upd[`games/${gameId}/players/${playerId}/${cardKey}`] = myCards;
            upd[`games/${gameId}/bjDeckIndex`]                    = newIndex;
            upd[`games/${gameId}/lastActivity`]                   = Date.now();

            if (total > 21) {
                if (onSplit) {
                    upd[`games/${gameId}/players/${playerId}/bjSplitDone`]   = true;
                    upd[`games/${gameId}/players/${playerId}/bjSplitResult`] = 'bust';
                    upd[`games/${gameId}/players/${playerId}/bjSplitPayout`] = 0;
                    await database.ref().update(upd);
                    addLog(`${playerName}'s split hand busts with ${total}!`);
                    await bjAdvanceTurn(state);
                } else {
                    upd[`games/${gameId}/players/${playerId}/bjDone`]   = true;
                    upd[`games/${gameId}/players/${playerId}/bjResult`] = 'bust';
                    upd[`games/${gameId}/players/${playerId}/bjPayout`] = 0;
                    await database.ref().update(upd);
                    addLog(`${playerName} busts with ${total}!`);
                    // If split hand exists and not done, move to it
                    if (state.players[playerId]?.bjSplitCards && !state.players[playerId]?.bjSplitDone) {
                        await database.ref(`games/${gameId}/players/${playerId}`).update({
                            bjOnSplitHand: true, bjTurnTimestamp: Date.now()
                        });
                    } else {
                        await bjAdvanceTurn(state);
                    }
                }
            } else if (total === 21) {
                if (onSplit) {
                    upd[`games/${gameId}/players/${playerId}/bjSplitDone`] = true;
                    await database.ref().update(upd);
                    addLog(`${playerName}'s split hand hits 21!`);
                    await bjAdvanceTurn(state);
                } else {
                    upd[`games/${gameId}/players/${playerId}/bjDone`] = true;
                    await database.ref().update(upd);
                    addLog(`${playerName} hits 21!`);
                    if (state.players[playerId]?.bjSplitCards && !state.players[playerId]?.bjSplitDone) {
                        await database.ref(`games/${gameId}/players/${playerId}`).update({
                            bjOnSplitHand: true, bjTurnTimestamp: Date.now()
                        });
                    } else {
                        await bjAdvanceTurn(state);
                    }
                }
            } else {
                await database.ref().update(upd);
                await database.ref(`games/${gameId}/bjTurnTimestamp`).set(Date.now());
            }
        } finally { bjActionSubmitting = false; }
    }

    async function bjStand() {
        if (bjActionSubmitting) return;
        const st = gameState;
        if (!st || st.bjCurrentTurn !== playerId || st.bjPhase !== 'playing') return;
        bjActionSubmitting = true;
        bjStopTimer();
        try {
            const snap = await database.ref(`games/${gameId}`).once('value');
            const state = snap.val();
            if (!state || state.bjCurrentTurn !== playerId) return;
            const onSplit = state.players[playerId]?.bjOnSplitHand || false;
            if (onSplit) {
                await database.ref(`games/${gameId}/players/${playerId}`).update({ bjSplitDone: true });
                addLog(`${playerName} stands on split hand.`);
                await bjAdvanceTurn(state);
            } else {
                await database.ref(`games/${gameId}/players/${playerId}`).update({ bjDone: true });
                addLog(`${playerName} stands.`);
                // Move to split hand if it exists
                if (state.players[playerId]?.bjSplitCards && !state.players[playerId]?.bjSplitDone) {
                    await database.ref(`games/${gameId}/players/${playerId}`).update({
                        bjOnSplitHand: true, bjTurnTimestamp: Date.now()
                    });
                } else {
                    await bjAdvanceTurn(state);
                }
            }
        } finally { bjActionSubmitting = false; }
    }

    async function bjDouble() {
        if (bjActionSubmitting) return;
        const st = gameState;
        if (!st || st.bjCurrentTurn !== playerId || st.bjPhase !== 'playing') return;
        const myPlayer = st.players?.[playerId];
        if (!myPlayer || myPlayer.bjCards?.length !== 2) return; // can only double on first 2 cards
        if (myPlayer.chips < myPlayer.bjBet) { showToast('Not enough chips to double!'); return; }
        bjActionSubmitting = true;
        bjStopTimer();
        try {
            const snap  = await database.ref(`games/${gameId}`).once('value');
            const state = snap.val();
            if (!state || state.bjCurrentTurn !== playerId) return;
            const freshPlayer = state.players[playerId];
            if (!freshPlayer) return;
            const deck = state.bjDeck;
            const di   = state.bjDeckIndex || 0;
            const { cards, newIndex } = bjDraw(deck, di, 1);
            const myCards  = [...(freshPlayer.bjCards), ...cards];
            const total    = bjHandTotal(myCards);
            const extraBet = freshPlayer.bjBet;
            if (freshPlayer.chips < extraBet) { showToast('Not enough chips to double!'); return; }
            const upd = {};
            upd[`games/${gameId}/players/${playerId}/bjCards`]   = myCards;
            upd[`games/${gameId}/players/${playerId}/bjBet`]     = freshPlayer.bjBet * 2;
            upd[`games/${gameId}/players/${playerId}/chips`]     = freshPlayer.chips - extraBet;
            upd[`games/${gameId}/players/${playerId}/bjDoubled`] = true;
            upd[`games/${gameId}/players/${playerId}/bjDone`]    = true;
            upd[`games/${gameId}/bjDeckIndex`]                   = newIndex;
            upd[`games/${gameId}/lastActivity`]                  = Date.now();
            if (total > 21) {
                upd[`games/${gameId}/players/${playerId}/bjResult`] = 'bust';
                upd[`games/${gameId}/players/${playerId}/bjPayout`] = 0;
            }
            await database.ref().update(upd);
            const resultTxt = total > 21 ? `busts (${total})` : `stands on ${total}`;
            addLog(`${playerName} doubles down — ${resultTxt}!`);
            await bjAdvanceTurn(state);
        } finally { bjActionSubmitting = false; }
    }

    // ── BJ: Split ────────────────────────────────────────────────────
    async function bjSplit() {
        if (bjActionSubmitting) return;
        const st = gameState;
        if (!st || st.bjCurrentTurn !== playerId || st.bjPhase !== 'playing') return;
        const myPlayer = st.players?.[playerId];
        if (!myPlayer) return;

        // Can only split on first two cards of same value, and only once
        const cards = myPlayer.bjCards || [];
        if (cards.length !== 2) { showToast('Can only split on first two cards!'); return; }
        if (bjCardValue(cards[0]) !== bjCardValue(cards[1])) { showToast('Cards must be the same value to split!'); return; }
        if (myPlayer.bjSplitCards) { showToast('Already split — cannot re-split!'); return; }
        if (myPlayer.chips < myPlayer.bjBet) { showToast('Not enough chips to split!'); return; }

        bjActionSubmitting = true;
        bjStopTimer();
        try {
            const snap  = await database.ref(`games/${gameId}`).once('value');
            const state = snap.val();
            if (!state || state.bjCurrentTurn !== playerId) return;
            const freshPlayer = state.players[playerId];
            if (!freshPlayer) return;

            const deck = state.bjDeck;
            const di   = state.bjDeckIndex || 0;

            // Draw one card for each hand
            const { cards: hand1Extra, newIndex: di1 } = bjDraw(deck, di, 1);
            const { cards: hand2Extra, newIndex: di2 } = bjDraw(deck, di1, 1);

            const primaryCards = [freshPlayer.bjCards[0], ...hand1Extra];
            const splitCards   = [freshPlayer.bjCards[1], ...hand2Extra];
            const splitBet     = freshPlayer.bjBet;

            const upd = {};
            upd[`games/${gameId}/players/${playerId}/bjCards`]       = primaryCards;
            upd[`games/${gameId}/players/${playerId}/bjSplitCards`]  = splitCards;
            upd[`games/${gameId}/players/${playerId}/bjSplitBet`]    = splitBet;
            upd[`games/${gameId}/players/${playerId}/chips`]         = freshPlayer.chips - splitBet;
            upd[`games/${gameId}/players/${playerId}/bjSplitDone`]   = false;
            upd[`games/${gameId}/players/${playerId}/bjSplitResult`] = null;
            upd[`games/${gameId}/players/${playerId}/bjSplitPayout`] = null;
            upd[`games/${gameId}/players/${playerId}/bjOnSplitHand`] = false;
            upd[`games/${gameId}/bjDeckIndex`]                       = di2;
            upd[`games/${gameId}/bjTurnTimestamp`]                   = Date.now();
            upd[`games/${gameId}/lastActivity`]                      = Date.now();
            await database.ref().update(upd);

            const p1total = bjHandTotal(primaryCards);
            const p2total = bjHandTotal(splitCards);
            addLog(`${playerName} splits! Hand 1: ${p1total} | Hand 2: ${p2total}`);

            // Auto-stand primary if it hit 21 from the draw
            if (p1total === 21) {
                await database.ref(`games/${gameId}/players/${playerId}`).update({
                    bjOnSplitHand: true,
                    bjTurnTimestamp: Date.now()
                });
                addLog(`${playerName}'s primary hand is 21 — moving to split hand`);
                // If split hand is also done (e.g. also 21)
                if (p2total === 21) {
                    await database.ref(`games/${gameId}/players/${playerId}/bjSplitDone`).set(true);
                    await bjAdvanceTurn(state);
                }
            }
        } finally { bjActionSubmitting = false; }
    }

    // ── BJ: Timer ────────────────────────────────────────────────────
    // ── BJ: Bet phase timer (counts down to bjBetDeadline) ─────────
    function bjStopBetTimer() {
        if (bjBetTimerInterval) { clearInterval(bjBetTimerInterval); bjBetTimerInterval = null; }
        bjBetTimerActive = false;
    }

    function bjStartBetTimer(deadlineMs) {
        bjStopBetTimer();
        const wrap  = document.getElementById('bjBetTimerWrap');
        const bar   = document.getElementById('bjBetTimerBar');
        const label = document.getElementById('bjBetTimerLabel');
        if (!wrap || !bar) return;
        // If deadline already passed, don't start
        if (deadlineMs <= Date.now()) return;
        wrap.classList.remove('hidden');
        bjBetTimerActive = true;
        const totalMs = BJ_BET_SECONDS * 1000;

        function tick() {
            const rem = Math.max(0, deadlineMs - Date.now());
            const pct = (rem / totalMs) * 100;
            bar.style.width = pct + '%';
            bar.style.background = pct > 50 ? 'linear-gradient(90deg,#4CAF50,#8BC34A)' :
                                   pct > 25 ? 'linear-gradient(90deg,#FF9800,#FFC107)' :
                                              'linear-gradient(90deg,#f44336,#FF5722)';
            if (label) label.textContent = Math.ceil(rem / 1000) + 's';
            if (rem <= 0) {
                bjStopBetTimer();
                // Auto-place minimum bet on timeout so player stays in the hand
                if (!bjActionSubmitting && gameState?.bjPhase === 'betting') {
                    const myP = gameState?.players?.[playerId];
                    if (myP && !myP.bjBet && !myP.bjSittingOut && myP.chips > 0) {
                        addLog(`⏱️ ${playerName} timed out — minimum bet placed automatically.`);
                        // Force the slider to min bet and place it
                        const sl = document.getElementById('bjBetSlider');
                        if (sl) sl.value = BJ_MIN_BET;
                        bjPlaceBet().catch(() => {});
                    }
                }
            }
        }
        tick();
        bjBetTimerInterval = setInterval(tick, 250);
    }

    function bjStopTimer() {
        if (bjTimerInterval) { clearInterval(bjTimerInterval); bjTimerInterval = null; }
        const wrap = document.getElementById('bjTurnTimerWrap');
        if (wrap) wrap.classList.add('hidden');
    }

    function bjStartTimer(tsMs) {
        bjStopTimer();
        const wrap  = document.getElementById('bjTurnTimerWrap');
        const bar   = document.getElementById('bjTurnTimerBar');
        const label = document.getElementById('bjTurnTimerLabel');
        if (!wrap || !bar) return;
        wrap.classList.remove('hidden');
        const deadline = tsMs + BJ_TURN_SECONDS * 1000;
        if (deadline <= Date.now()) return;

        function tick() {
            const rem = Math.max(0, deadline - Date.now());
            const pct = (rem / (BJ_TURN_SECONDS * 1000)) * 100;
            bar.style.width = pct + '%';
            bar.style.background = pct > 50 ? 'linear-gradient(90deg,#4CAF50,#8BC34A)' :
                                   pct > 25 ? 'linear-gradient(90deg,#FF9800,#FFC107)' :
                                              'linear-gradient(90deg,#f44336,#FF5722)';
            if (label) label.textContent = Math.ceil(rem / 1000) + 's';
            if (rem <= 0) {
                bjStopTimer();
                // Auto-stand on timeout
                bjStand().catch(() => {});
            }
        }
        tick();
        bjTimerInterval = setInterval(tick, 250);
    }

    // ── BJ: Wire action buttons ──────────────────────────────────────
    document.getElementById('bjBetSlider')?.addEventListener('input', () => {
        const v = document.getElementById('bjBetSlider').value;
        const inp = document.getElementById('bjBetInput');
        if (inp) inp.value = v;
        const disp = document.getElementById('bjBetDisplay');
        if (disp) disp.textContent = v;
    });
    document.getElementById('bjBetInput')?.addEventListener('input', () => {
        const myChipsNow = gameState?.players?.[playerId]?.chips || 0;
        const halfChips = Math.max(BJ_MIN_BET, Math.floor(myChipsNow / 2));
        const v = Math.max(BJ_MIN_BET, Math.min(Math.min(BJ_MAX_BET, halfChips), parseInt(document.getElementById('bjBetInput').value) || BJ_MIN_BET));
        const sl = document.getElementById('bjBetSlider');
        if (sl) sl.value = v;
        const disp = document.getElementById('bjBetDisplay');
        if (disp) disp.textContent = v;
    });
    document.getElementById('bjBetBtn')?.addEventListener('click', bjPlaceBet);
    document.getElementById('bjSitOutRoundBtn')?.addEventListener('click', bjSkipRound);
    document.getElementById('bjHitBtn')?.addEventListener('click', bjHit);
    document.getElementById('bjStandBtn')?.addEventListener('click', bjStand);
    document.getElementById('bjDoubleBtn')?.addEventListener('click', bjDouble);
    document.getElementById('bjSplitBtn')?.addEventListener('click', bjSplit);

    // ── BJ sit-out / return buttons ─────────────────────────────────
    // "Return to Game" — clears persistent sit-out flag (same as poker wakeUpBtn)
    document.getElementById('bjWakeUpBtn')?.addEventListener('click', async () => {
        if (!gameId || !playerId) return;
        await database.ref(`games/${gameId}/players/${playerId}`).update({
            sittingOut: false,
            sitOutPending: false,
            timeoutFolds: 0
        });
        isSittingOutPending = false;
        addLog(`☀️ ${playerName} will return to the game next hand.`);
    });

    // "Sit Out Next Hand" toggle — same logic as poker sitOutBtn
    document.getElementById('bjSitOutBtn')?.addEventListener('click', async () => {
        if (!gameId || !playerId) return;
        const cur = gameState?.players?.[playerId];
        if (!cur) return;

        if (cur.sittingOut) {
            await database.ref(`games/${gameId}/players/${playerId}/sittingOut`).set(false);
            await database.ref(`games/${gameId}/players/${playerId}/sitOutPending`).set(false);
            isSittingOutPending = false;
            showToast('✅ You will re-join from the next hand.');
        } else if (isSittingOutPending || cur.sitOutPending) {
            await database.ref(`games/${gameId}/players/${playerId}/sitOutPending`).set(false);
            isSittingOutPending = false;
            showToast('❌ Sit-out cancelled.');
        } else {
            await database.ref(`games/${gameId}/players/${playerId}/sitOutPending`).set(true);
            isSittingOutPending = true;
            showToast('💤 You will sit out after this hand.');
        }
        updateBJSitOutBtn();
    });

    function updateBJSitOutBtn() {
        const btn = document.getElementById('bjSitOutBtn');
        if (!btn || !gameState || !playerId) return;
        const cur = gameState?.players?.[playerId];
        if (!cur) { btn.textContent = '💤 Sit Out Next Hand'; btn.className = 'sitout-toggle-btn'; return; }
        if (cur.sittingOut) {
            btn.textContent = '☀️ Return to Game (next hand)';
            btn.className = 'sitout-toggle-btn';
            btn.style.background = 'rgba(76,175,80,0.2)';
            btn.style.borderColor = 'rgba(76,175,80,0.4)';
            btn.style.color = '#81c784';
        } else if (isSittingOutPending || cur.sitOutPending) {
            btn.textContent = '❌ Cancel Sit-Out';
            btn.className = 'sitout-toggle-btn pending';
            btn.style.background = '';
            btn.style.borderColor = '';
            btn.style.color = '';
        } else {
            btn.textContent = '💤 Sit Out Next Hand';
            btn.className = 'sitout-toggle-btn';
            btn.style.background = '';
            btn.style.borderColor = '';
            btn.style.color = '';
        }
    }

    // ── BJ: UI update — called from updateUI when gameType === 'blackjack' ──
    function updateBJUI() {
        if (!gameState || gameState.gameType !== 'blackjack') return;
        const players  = gameState.players || {};
        const phase    = gameState.bjPhase;
        const myPlayer = players[playerId];
        const iAmTurn  = gameState.bjCurrentTurn === playerId;
        const isAdmin  = gameState.adminId === playerId;
        const isInitialLobby = !gameState.gameStarted;

        // ── BJ Lobby overlay (before first hand) ────────────────────
        const bjLobbyEl = document.getElementById('bjWaitingLobby');
        if (bjLobbyEl) {
            if (isInitialLobby && gameState.status === 'waiting') {
                bjLobbyEl.style.display = 'flex';
                bjLobbyEl.classList.remove('hidden');
                // Player count
                const playerIds = Object.keys(players);
                const bjCountEl = document.getElementById('bjLobbyPlayerCount');
                if (bjCountEl) bjCountEl.textContent = `${playerIds.length}/${gameState.maxPlayers || 8}`;
                // Start button (admin only) — non-admin sees a waiting message instead
                const bjStartBtn = document.getElementById('bjStartGameBtn');
                if (bjStartBtn) {
                    bjStartBtn.classList.toggle('hidden', !isAdmin || playerIds.length < 1);
                    if (!bjStartBtn._bjBound) {
                        bjStartBtn._bjBound = true;
                        bjStartBtn.addEventListener('click', () => bjStartHand().catch(console.error));
                    }
                }
                // Non-admin waiting hint
                const bjLobbyHint = document.getElementById('bjLobbyHint');
                if (bjLobbyHint) {
                    bjLobbyHint.textContent = isAdmin
                        ? (playerIds.length < 1 ? 'Waiting for players to join...' : 'Press Start Game when ready!')
                        : 'Waiting for the admin to start the game...';
                }
                // Admin player list
                const bjAdminList = document.getElementById('bjAdminPlayerList');
                if (bjAdminList) {
                    bjAdminList.classList.toggle('hidden', !isAdmin);
                    if (isAdmin) {
                        bjAdminList.innerHTML = '<div style="font-size:0.85em;margin-bottom:8px;opacity:0.7;">👑 Players in room (use Admin Panel for management):</div>';
                        playerIds.forEach(pid => {
                            const p = players[pid];
                            if (!p || !p.name) return;
                            const row = document.createElement('div');
                            row.className = 'admin-player-row';
                            row.innerHTML = pid === playerId
                                ? `<span>${escapeHtml(p.name)} <span class="you-tag">(You)</span></span>`
                                : `<span>${escapeHtml(p.name)}</span>
                                   <div class="admin-row-btns">
                                     <button class="promote-btn" data-pid="${pid}" title="Make admin">👑</button>
                                     <button class="kick-btn" data-pid="${pid}">Kick</button>
                                   </div>`;
                            bjAdminList.appendChild(row);
                        });
                        bjAdminList.querySelectorAll('.kick-btn').forEach(b =>
                            b.addEventListener('click', () => kickPlayer(b.dataset.pid)));
                        bjAdminList.querySelectorAll('.promote-btn').forEach(b =>
                            b.addEventListener('click', () => promotePlayer(b.dataset.pid)));
                    }
                }
            } else {
                bjLobbyEl.style.display = 'none';
                bjLobbyEl.classList.add('hidden');
            }
        }

        // ── Hide/show game area based on lobby state ─────────────────
        const bjGameArea = document.getElementById('bjGameArea');
        if (bjGameArea) {
            bjGameArea.style.display = (isInitialLobby && gameState.status === 'waiting') ? 'none' : '';
        }

        // ── Panels ──────────────────────────────────────────────────
        const betPanel       = document.getElementById('bjBetPanel');
        const actPanel       = document.getElementById('bjActionPanel');
        const waitPanel      = document.getElementById('bjWaitPanel');
        const waitMsg        = document.getElementById('bjWaitMsg');
        const sitOutPanel    = document.getElementById('bjSittingOutPanel');
        const sitOutBtnWrap  = document.getElementById('bjSitOutBtnWrap');
        const allPanels = [betPanel, actPanel, waitPanel, sitOutPanel];
        allPanels.forEach(el => el?.classList.add('hidden'));
        if (sitOutBtnWrap) sitOutBtnWrap.classList.add('hidden');

        // ── Chip display ─────────────────────────────────────────────
        const chipEl = document.getElementById('bjPlayerChips');
        if (chipEl) chipEl.textContent = myPlayer?.chips ?? 0;

        // ── Dealer cards ─────────────────────────────────────────────
        const dealerCardsEl = document.getElementById('bjDealerCards');
        const dealerScoreEl = document.getElementById('bjDealerScore');
        if (dealerCardsEl) {
            dealerCardsEl.innerHTML = '';
            const dc = gameState.bjDealerCards || [];

            if (phase === 'betting' || phase === 'idle' || !phase) {
                // Betting phase: no cards dealt yet — show a subtle placeholder
                const placeholder = document.createElement('div');
                placeholder.style.cssText = 'font-size:0.82em;opacity:0.4;padding:10px 0;';
                placeholder.textContent = 'Cards dealt after bets are placed';
                dealerCardsEl.appendChild(placeholder);
                if (dealerScoreEl) dealerScoreEl.textContent = '';
            } else {
                dc.forEach(c => dealerCardsEl.appendChild(makeCard(c)));
                // Show face-down hole card slot while players are still acting
                if (phase === 'playing' || phase === 'dealing') {
                    const hidden = document.createElement('div');
                    hidden.className = 'card bj-hidden';
                    dealerCardsEl.appendChild(hidden);
                }
                const dealerTotal = bjHandTotal(dc);
                if (dealerScoreEl) {
                    dealerScoreEl.textContent = dc.length
                        ? (phase === 'results' || phase === 'dealer'
                            ? bjHandLabel(dc)
                            : `Showing: ${dealerTotal}`)
                        : '';
                }
            }
        }

        // ── Your cards ───────────────────────────────────────────────
        const myCardsEl = document.getElementById('bjPlayerCards');
        const myScoreEl = document.getElementById('bjPlayerScore');
        const myHandSec = document.getElementById('bjPlayerHandSection');
        if (myCardsEl && myPlayer) {
            myCardsEl.innerHTML = '';
            const mc = myPlayer.bjCards || [];
            // Primary hand label
            if (mc.length > 0) {
                const handLabel = document.createElement('div');
                handLabel.style.cssText = 'font-size:0.78em;opacity:0.6;margin-bottom:4px;text-align:center;';
                handLabel.textContent = myPlayer.bjSplitCards ? 'Hand 1' : '';
                myCardsEl.appendChild(handLabel);
            }
            mc.forEach(c => {
                const cardEl = makeCard(c);
                // Dim primary hand when playing split hand
                if (myPlayer.bjOnSplitHand) cardEl.style.opacity = '0.5';
                myCardsEl.appendChild(cardEl);
            });
            if (myScoreEl) myScoreEl.textContent = mc.length ? bjHandLabel(mc) : '';

            // Split hand display
            const splitCardsEl = document.getElementById('bjSplitCardsDisplay') ||
                (() => {
                    const el = document.createElement('div');
                    el.id = 'bjSplitCardsDisplay';
                    el.className = 'cards-display';
                    el.style.marginTop = '12px';
                    myCardsEl.parentNode.insertBefore(el, myCardsEl.nextSibling);
                    return el;
                })();
            // Inject split score el if needed
            let splitScoreEl = document.getElementById('bjSplitScore');
            if (!splitScoreEl) {
                splitScoreEl = document.createElement('div');
                splitScoreEl.id = 'bjSplitScore';
                splitScoreEl.style.cssText = 'font-size:1em;color:#ffd700;font-weight:bold;margin-top:4px;min-height:1.3em;text-align:center;';
                splitCardsEl.parentNode.insertBefore(splitScoreEl, splitCardsEl.nextSibling);
            }

            const sc = myPlayer.bjSplitCards || [];
            splitCardsEl.innerHTML = '';
            splitScoreEl.textContent = '';
            if (sc.length > 0) {
                const splitLabel = document.createElement('div');
                splitLabel.style.cssText = 'font-size:0.78em;opacity:0.6;margin-bottom:4px;text-align:center;';
                splitLabel.textContent = 'Hand 2';
                splitCardsEl.appendChild(splitLabel);
                sc.forEach(c => {
                    const cardEl = makeCard(c);
                    if (!myPlayer.bjOnSplitHand) cardEl.style.opacity = '0.5';
                    splitCardsEl.appendChild(cardEl);
                });
                splitScoreEl.textContent = bjHandLabel(sc);
                // Highlight active hand
                if (myPlayer.bjOnSplitHand) {
                    splitCardsEl.style.background = 'rgba(76,175,80,0.1)';
                    splitCardsEl.style.borderRadius = '8px';
                    splitCardsEl.style.padding = '4px';
                } else {
                    splitCardsEl.style.background = '';
                    splitCardsEl.style.padding = '';
                }
            }
        }
        if (myHandSec) myHandSec.style.display = (myPlayer?.bjCards?.length > 0) ? '' : 'none';

        // ── Other players ─────────────────────────────────────────────
        updateBJPlayers(players);

        // ── Phase label ───────────────────────────────────────────────
        const rlbl = document.getElementById('bjRoundLabel');
        if (rlbl) {
            const phaseLabels = { betting:'— Betting Phase', dealing:'— Dealing...', playing:'— Players Acting', dealer:"— Dealer's Turn", dealerRunning:"— Dealer's Turn", results:'— Results', idle:'' };
            rlbl.textContent = phaseLabels[phase] || '';
        }

        // ── Bet total display ─────────────────────────────────────────
        const bjPotEl = document.getElementById('bjPotAmount');
        if (bjPotEl) {
            const totalBets = Object.values(players).reduce((sum, p) => sum + (p.bjBet || 0), 0);
            bjPotEl.textContent = totalBets;
        }

        // ── Sit-out / spectator handling (mirrors poker updateActionPanel) ──
        if (!myPlayer) return;

        if (myPlayer.spectating || myPlayer.pendingAdmit || myPlayer.admittedNextHand || myPlayer.admittedNextHand2) {
            // Spectator queue — show spectating panel
            if (sitOutPanel) {
                sitOutPanel.classList.remove('hidden');
                const icon   = document.getElementById('bjSittingOutIcon');
                const title  = document.getElementById('bjSittingOutTitle');
                const reason = document.getElementById('bjSittingOutReason');
                const wakeBtn = document.getElementById('bjWakeUpBtn');
                if (icon)   icon.textContent  = myPlayer.pendingAdmit ? '⏳' : (myPlayer.admittedNextHand || myPlayer.admittedNextHand2) ? '🃏' : '👁️';
                if (title)  title.textContent = myPlayer.pendingAdmit ? 'Waiting to be admitted' : (myPlayer.admittedNextHand || myPlayer.admittedNextHand2) ? 'Joining next hand…' : 'You are spectating';
                if (reason) reason.textContent = myPlayer.pendingAdmit
                    ? 'Wait for the room admin to admit you.'
                    : myPlayer.admittedNextHand || myPlayer.admittedNextHand2
                        ? "You've been admitted! You'll be dealt in next hand 🃏"
                        : 'You are spectating. The admin can admit you to play.';
                if (wakeBtn) wakeBtn.style.display = 'none'; // only admin admits spectators
            }
            bjStopBetTimer(); bjStopTimer();
            return;
        }

        // Restore wake-up button for non-spectators
        const wakeBtn = document.getElementById('bjWakeUpBtn');
        if (wakeBtn) wakeBtn.style.display = '';

        // Player has no chips left — show observer panel
        if (myPlayer.chips <= 0 && !myPlayer.bjBet) {
            if (sitOutPanel) {
                sitOutPanel.classList.remove('hidden');
                const icon   = document.getElementById('bjSittingOutIcon');
                const title  = document.getElementById('bjSittingOutTitle');
                const reason = document.getElementById('bjSittingOutReason');
                if (icon)   icon.textContent  = '💀';
                if (title)  title.textContent  = 'Out of chips';
                if (reason) reason.textContent = "You've run out of chips. Better luck next game!";
            }
            bjStopBetTimer(); bjStopTimer();
            return;
        }

        // Sitting out (persistent, cross-hand) — show sit-out panel with return button
        if (myPlayer.sittingOut) {
            if (sitOutPanel) {
                sitOutPanel.classList.remove('hidden');
                const icon   = document.getElementById('bjSittingOutIcon');
                const title  = document.getElementById('bjSittingOutTitle');
                const reason = document.getElementById('bjSittingOutReason');
                if (icon)   icon.textContent  = '💤';
                if (title)  title.textContent  = 'You are sitting out';
                if (reason) reason.textContent = myPlayer.sitOutReason === 'timeout'
                    ? 'Sat out after 2 consecutive timeouts. Click below to rejoin.'
                    : 'Click below to rejoin from the next hand.';
                if (wakeBtn) wakeBtn.style.display = '';
            }
            bjStopBetTimer(); bjStopTimer();
            return;
        }

        // ── Active player — show phase-appropriate panel ──────────────

        // Sitting out just THIS round (bjSittingOut) but still active overall
        if (myPlayer.bjSittingOut) {
            bjStopBetTimer();
            if (waitPanel) { waitPanel.classList.remove('hidden'); if (waitMsg) waitMsg.textContent = '💤 Sitting out this round — watching...'; }
            // Still show the sit-out toggle so they can re-enable for next hand
            if (sitOutBtnWrap) sitOutBtnWrap.classList.remove('hidden');
            return;
        }

        if (phase === 'betting') {
            if (myPlayer.bjBet > 0) {
                bjStopBetTimer();
                if (waitPanel) { waitPanel.classList.remove('hidden'); if (waitMsg) waitMsg.textContent = `✅ Bet placed: $${myPlayer.bjBet} — waiting for others...`; }
            } else {
                betPanel?.classList.remove('hidden');
                const sl = document.getElementById('bjBetSlider');
                const maxBet = Math.min(BJ_MAX_BET, Math.max(BJ_MIN_BET, Math.floor(myPlayer.chips / 2)));
                if (sl) {
                    sl.min = BJ_MIN_BET;
                    sl.max = maxBet;
                    // Clamp current value to valid range
                    const clamped = Math.max(BJ_MIN_BET, Math.min(maxBet, parseInt(sl.value) || BJ_MIN_BET));
                    sl.value = clamped;
                    const disp = document.getElementById('bjBetDisplay');
                    const inp  = document.getElementById('bjBetInput');
                    if (disp) disp.textContent = clamped;
                    if (inp)  { inp.min = BJ_MIN_BET; inp.max = maxBet; inp.value = clamped; }
                }
                const deadline = gameState.bjBetDeadline || 0;
                if (deadline > Date.now() && !bjBetTimerActive) bjStartBetTimer(deadline);
            }
            if (sitOutBtnWrap) sitOutBtnWrap.classList.remove('hidden');

        } else if (phase === 'playing') {
            bjStopBetTimer();
            const onSplit   = myPlayer.bjOnSplitHand || false;
            const primaryDone = myPlayer.bjDone || false;
            const splitDone   = myPlayer.bjSplitDone || false;
            const myFullyDone = primaryDone && (!myPlayer.bjSplitCards || splitDone);
            if (iAmTurn && !myFullyDone) {
                actPanel?.classList.remove('hidden');
                const dblBtn   = document.getElementById('bjDoubleBtn');
                const splitBtn = document.getElementById('bjSplitBtn');
                const activeCards = onSplit ? (myPlayer.bjSplitCards || []) : (myPlayer.bjCards || []);
                // Double down: only on first 2 cards of current hand, enough chips
                if (dblBtn) dblBtn.disabled = (activeCards.length !== 2 || myPlayer.chips < (onSplit ? myPlayer.bjSplitBet : myPlayer.bjBet));
                // Split: only on first 2 cards of same value, no existing split, enough chips
                if (splitBtn) {
                    const mainCards = myPlayer.bjCards || [];
                    const canSplit = !onSplit && !myPlayer.bjSplitCards && mainCards.length === 2 &&
                        bjCardValue(mainCards[0]) === bjCardValue(mainCards[1]) &&
                        myPlayer.chips >= myPlayer.bjBet;
                    splitBtn.disabled = !canSplit;
                    splitBtn.style.opacity = canSplit ? '1' : '0.4';
                }
                // Label which hand we're on
                const timerLabel = document.querySelector('#bjTurnTimerWrap .turn-timer-text');
                if (timerLabel) timerLabel.textContent = onSplit ? '⏱ Split hand — your turn' : '⏱ Your turn';
                const ts = gameState.bjTurnTimestamp || 0;
                if (ts !== bjTimerDeadline) { bjTimerDeadline = ts; bjStartTimer(ts); }
            } else if (!myFullyDone) {
                const whoName = players[gameState.bjCurrentTurn]?.name || '...';
                if (waitPanel) { waitPanel.classList.remove('hidden'); if (waitMsg) waitMsg.textContent = `Waiting for ${whoName}...`; }
                bjStopTimer();
            } else {
                // Done this round — waiting for others / dealer
                const r = myPlayer.bjResult;
                const doneMsg = r === 'bust' ? '💀 You busted — waiting for dealer...' : '✋ Standing — waiting for dealer...';
                if (waitPanel) { waitPanel.classList.remove('hidden'); if (waitMsg) waitMsg.textContent = doneMsg; }
                bjStopTimer();
            }

        } else if (phase === 'dealer' || phase === 'dealerRunning') {
            bjStopBetTimer();
            if (waitPanel) { waitPanel.classList.remove('hidden'); if (waitMsg) waitMsg.textContent = '🎰 Dealer is playing...'; }
            bjStopTimer();

        } else if (phase === 'results') {
            bjStopBetTimer(); bjStopTimer();
            const r = myPlayer.bjResult;
            if (r) {
                const resultMsgs = { win:'✅ You win!', blackjack:'🌟 Blackjack! +150%', push:'🤝 Push — bet returned', lose:'❌ You lose', bust:'💀 Bust — you lose' };
                if (waitPanel) { waitPanel.classList.remove('hidden'); if (waitMsg) waitMsg.textContent = resultMsgs[r] || ''; }
            }

        } else {
            // idle / dealing — just wait
            bjStopBetTimer();
            if (waitPanel) { waitPanel.classList.remove('hidden'); if (waitMsg) waitMsg.textContent = 'Waiting...'; }
        }

        // Bet deadline watchdog — any client fires bjDealCards when deadline passes
        // Guard: only fire once per deadline (local flag prevents flooding)
        if (phase === 'betting' && gameState.bjBetDeadline) {
            if (gameState.bjBetDeadline - Date.now() < 500 && !bjActionSubmitting) {
                bjDealCards().catch(() => {});
            }
        }
    }

    function makeCard(card) {
        const div = document.createElement('div');
        div.className = 'card';
        if (card) {
            div.textContent = card.rank + card.suit;
            div.classList.add(card.suit === '♥' || card.suit === '♦' ? 'red' : 'black');
        } else {
            div.classList.add('card-back');
        }
        return div;
    }

    function updateBJPlayers(players) {
        const container = document.getElementById('bjPlayersContainer');
        if (!container) return;
        container.innerHTML = '';
        const phase = gameState?.bjPhase;
        Object.entries(players).forEach(([id, p]) => {
            if (id === playerId || !p || !p.name) return;
            if (p.leftAt && !p.isActive) return;
            const box = document.createElement('div');
            box.className = 'player-box';
            if (gameState?.bjCurrentTurn === id) box.classList.add('bj-active-turn');

            const cards = p.bjCards || [];
            const splitCards = p.bjSplitCards || [];
            const total = bjHandTotal(cards);
            const cardHTML = cards.map(c => {
                const col = (c.suit === '♥' || c.suit === '♦') ? 'red' : 'black';
                const dim = p.bjOnSplitHand ? ' style="opacity:0.5"' : '';
                return `<div class="mini-card ${col}"${dim}>${c.rank}${c.suit}</div>`;
            }).join('');
            const splitCardHTML = splitCards.map(c => {
                const col = (c.suit === '♥' || c.suit === '♦') ? 'red' : 'black';
                const dim = !p.bjOnSplitHand ? ' style="opacity:0.5"' : '';
                return `<div class="mini-card ${col}"${dim}>${c.rank}${c.suit}</div>`;
            }).join('');

            let resultBadge = '';
            if (p.bjResult) {
                const cls = p.bjResult === 'win' || p.bjResult === 'blackjack' ? 'bj-result-win' :
                            p.bjResult === 'push' ? 'bj-result-push' :
                            p.bjResult === 'bust' ? 'bj-result-bust' : 'bj-result-lose';
                const lbl = p.bjResult === 'blackjack' ? '🌟 BJ' : p.bjResult === 'win' ? '✅ Win' :
                            p.bjResult === 'push' ? '🤝 Push' : p.bjResult === 'bust' ? '💀 Bust' : '❌ Lose';
                resultBadge = `<div class="bj-result-badge ${cls}">${lbl}</div>`;
            }

            const betInfo = p.bjBet > 0 ? `<div class="bet">Bet: $${p.bjBet}</div>` : '';
            const scoreInfo = cards.length > 0 ? `<div class="status" style="color:#ffd700;">${bjHandLabel(cards)}</div>` : '';
            const sittingOut = p.bjSittingOut ? '<div class="status" style="opacity:0.5;">Sitting out</div>' : '';

            const splitTotal = bjHandTotal(splitCards);
            const splitScoreInfo = splitCards.length > 0 ? `<div class="status" style="color:#ffd700;font-size:0.8em;">Split: ${bjHandLabel(splitCards)}</div>` : '';
            let splitResultBadge = '';
            if (p.bjSplitResult) {
                const sr = p.bjSplitResult;
                const scls = sr === 'win' ? 'bj-result-win' : sr === 'push' ? 'bj-result-push' : sr === 'bust' ? 'bj-result-bust' : 'bj-result-lose';
                const slbl = sr === 'win' ? '✅ Win' : sr === 'push' ? '🤝 Push' : sr === 'bust' ? '💀 Bust' : '❌ Lose';
                splitResultBadge = `<div class="bj-result-badge ${scls}" style="font-size:0.75em;">${slbl} (split)</div>`;
            }
            box.innerHTML = `
                <div class="player-box-header"><h4>${escapeHtml(p.name)}</h4></div>
                <div class="chips">$${p.chips}</div>
                ${betInfo}
                ${cards.length > 0 ? `<div class="revealed-cards">${cardHTML}</div>` : ''}
                ${scoreInfo}
                ${splitCards.length > 0 ? `<div class="revealed-cards" style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.2);padding-top:6px;">${splitCardHTML}</div>` : ''}
                ${splitScoreInfo}
                ${resultBadge}${splitResultBadge}
                ${sittingOut}`;
            container.appendChild(box);
        });
    }

    // ── BJ: listenToGame integration — call updateBJUI when it's a BJ room ──
    // (This is hooked into updateUI below)

    // ── BJ: Admin start game button triggers bjStartHand ─────────────
    // (BJ dispatch is handled inside startGame directly)

    // ══════════════════════════════════════════════════════════════
    //  TURN WATCHDOG — guaranteed turn resolution
    //  Runs every 5s. If there's a currentTurnPlayerId but no one
    //  has acted and TURN_SECONDS+20s have passed, force-advance.
    //  Only the room admin runs this to prevent race conditions.
    // ══════════════════════════════════════════════════════════════
    const WATCHDOG_GRACE = (TURN_SECONDS + 20) * 1000; // generous buffer above turn time

    setInterval(async () => {
        if (!gameId || !gameState || gameState.status !== 'playing') return;
        // Only the room admin runs the watchdog — prevents all clients racing
        if (gameState.adminId !== playerId) return;
        // Never fire while a local action write is in-flight — the turnTimestamp
        // hasn't been updated in Firebase yet so the turn would look falsely stale.
        if (actionSubmitting) return;
        const tid = gameState.currentTurnPlayerId;
        if (!tid) return; // No active turn
        const ts  = gameState.turnTimestamp || 0;
        if (Date.now() - ts < WATCHDOG_GRACE) return; // Still within grace period

        // Snapshot the turn ID before the async read — if it changes during the read, abort
        const tidBeforeRead = tid;

        // Turn looks stale — verify with fresh Firebase read
        const snap = await database.ref(`games/${gameId}`).once('value');
        const state = snap.val();
        if (!state || state.status !== 'playing' || !state.currentTurnPlayerId) return;
        // Abort if the turn changed while we were reading (action in flight)
        if (state.currentTurnPlayerId !== tidBeforeRead) return;
        if (Date.now() - (state.turnTimestamp || 0) < WATCHDOG_GRACE) return;

        console.warn('[WATCHDOG] Stale turn detected — force-advancing:', state.currentTurnPlayerId);
        const wdEl = document.getElementById('watchdogIndicator');
        if (wdEl) { wdEl.textContent = `⚠ WD ${new Date().toLocaleTimeString()}`; setTimeout(() => { if (wdEl) wdEl.textContent = ''; }, 5000); }
        const stalePid = state.currentTurnPlayerId;
        const stalePlayer = state.players[stalePid];
        if (!stalePlayer) return;

        // Auto-fold the stale player
        const updPlayers = { ...state.players };
        updPlayers[stalePid] = { ...updPlayers[stalePid], folded: true };
        const remaining = Object.entries(updPlayers).filter(([, p]) => !p.folded && !p.spectating && !p.pendingAdmit && !p.observer);
        const upd = {};
        upd[`games/${gameId}/players/${stalePid}/folded`] = true;

        if (remaining.length === 1) {
            upd[`games/${gameId}/currentTurnPlayerId`] = null;
            await database.ref().update(upd);
            await awardPotToPlayer(remaining[0][0]);
        } else {
            const nextId = getNextTurnPlayerId(stalePid, updPlayers);
            upd[`games/${gameId}/currentTurnPlayerId`] = nextId;
            upd[`games/${gameId}/turnTimestamp`] = Date.now();
            await database.ref().update(upd);
            await database.ref(`games/${gameId}/chat`).push({
                senderId: 'system', senderName: '🎲 System',
                message: `⏱️ ${stalePlayer.name || 'A player'} was force-folded by the watchdog (turn stalled).`,
                timestamp: Date.now()
            });
        }
        addLog(`[WATCHDOG] ${stalePlayer.name || stalePid} force-folded — stale turn recovered.`);
    }, 5000);

    // ══════════════════════════════════════════════════════════════
    //  BJ DEALER STALL WATCHDOG
    //  If bjPhase==='dealer' persists >10s without bjRunDealer claiming it,
    //  the earliest active player re-triggers bjRunDealer.
    // ══════════════════════════════════════════════════════════════
    setInterval(async () => {
        if (!gameId || !gameState) return;
        if (gameState.gameType !== 'blackjack') return;
        if (gameState.bjPhase !== 'dealer') return;
        if (Date.now() - (gameState.lastActivity || 0) < 10000) return;

        const activePlayers = Object.entries(gameState.players || {})
            .filter(([, p]) => !p.leftAt && p.isActive)
            .sort(([, a], [, b]) => (a.joinedAt || 0) - (b.joinedAt || 0));
        if (!activePlayers.length || activePlayers[0][0] !== playerId) return;

        const snap = await database.ref(`games/${gameId}`).once('value');
        const st = snap.val();
        if (!st || st.bjPhase !== 'dealer') return;
        if (Date.now() - (st.lastActivity || 0) < 10000) return;

        console.warn('[BJ WATCHDOG] Dealer stall — re-triggering bjRunDealer');
        await bjRunDealer();
    }, 5000);

    // ══════════════════════════════════════════════════════════════
    //  BJ RESULTS STALL WATCHDOG
    //  If bjPhase==='results' persists >8s without bjReset clearing it,
    //  the earliest active player forces bjReset.
    // ══════════════════════════════════════════════════════════════
    setInterval(async () => {
        if (!gameId || !gameState) return;
        if (gameState.gameType !== 'blackjack') return;
        if (gameState.bjPhase !== 'results') return;
        // Only act if results phase has been stuck >8s (lastActivity is set when results written)
        const stuckMs = Date.now() - (gameState.lastActivity || 0);
        if (stuckMs < 8000) return;

        // Only the earliest active player acts to avoid race conditions
        const activePlayers = Object.entries(gameState.players || {})
            .filter(([, p]) => !p.leftAt && p.isActive)
            .sort(([, a], [, b]) => (a.joinedAt || 0) - (b.joinedAt || 0));
        if (!activePlayers.length || activePlayers[0][0] !== playerId) return;

        // Verify with fresh state
        const snap = await database.ref(`games/${gameId}`).once('value');
        const st = snap.val();
        if (!st || st.bjPhase !== 'results') return;
        if (Date.now() - (st.lastActivity || 0) < 8000) return;

        console.warn('[BJ WATCHDOG] Results stall detected — forcing bjReset');
        await bjReset();
    }, 3000);

    // ══════════════════════════════════════════════════════════════
    //  ROUND-WINNER STALL WATCHDOG
    //  If roundWinner has been set for >8s without resetGame clearing it
    //  (e.g. the client that set it left), the leader triggers resetGame.
    // ══════════════════════════════════════════════════════════════
    const ROUND_WINNER_STALL_MS = 8000;
    setInterval(async () => {
        if (!gameId || !gameState) return;
        const rw = gameState.roundWinner;
        if (!rw || !rw.setAt) return; // no stalled winner
        if (Date.now() - rw.setAt < ROUND_WINNER_STALL_MS) return;

        // Verify with fresh state
        const snap = await database.ref(`games/${gameId}`).once('value');
        const state = snap.val();
        if (!state || !state.roundWinner || !state.roundWinner.setAt) return;
        if (Date.now() - state.roundWinner.setAt < ROUND_WINNER_STALL_MS) return;

        // Only the leader acts
        const activePlayers = Object.entries(state.players || {})
            .filter(([, p]) => !p.leftAt && p.isActive)
            .sort(([, a], [, b]) => (a.joinedAt || 0) - (b.joinedAt || 0));
        if (!activePlayers.length || activePlayers[0][0] !== playerId) return;

        console.warn('[WATCHDOG] Round-winner screen stalled — forcing resetGame');
        await database.ref(`games/${gameId}/chat`).push({
            senderId: 'system', senderName: '🎲 System',
            message: '🔄 Next round starting (stall recovery).',
            timestamp: Date.now()
        });
        resetGame();
    }, 3000);

} catch (err) {
    console.error('❌ FATAL ERROR:', err);
    console.error('FATAL LOAD ERROR:', err.message); showAlert && showAlert('Failed to load game: ' + err.message + '\n\nSee console (F12) for details.', '💥').catch(()=>{});
}
