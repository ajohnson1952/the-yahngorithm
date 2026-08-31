// ============================================================
// FBS rivalry pairs — hand-curated (PROJECT_BRIEF: "not derivable from an API")
// ============================================================
// Team names must match Team.canonicalName exactly (CFBD's school
// names — e.g. "App State" not "Appalachian State", "Ole Miss",
// "Miami" vs "Miami (OH)", "Hawai'i", "San José State").
// The seed script validates every name and reports typos.
//
// Used by the 'lookahead' situational flag (big favorite this week,
// rivalry game looming next week) and for display. Order within a
// pair doesn't matter — the seeder normalizes it.
// ============================================================

export interface RivalryPair {
  a: string;
  b: string;
  name: string;
}

export const RIVALRIES: RivalryPair[] = [
  // --- SEC ---
  { a: "Alabama", b: "Auburn", name: "Iron Bowl" },
  { a: "Alabama", b: "Tennessee", name: "Third Saturday in October" },
  { a: "Auburn", b: "Georgia", name: "Deep South's Oldest Rivalry" },
  { a: "Georgia", b: "Florida", name: "World's Largest Outdoor Cocktail Party" },
  { a: "Florida", b: "Florida State", name: "Florida–Florida State" },
  { a: "Florida", b: "Tennessee", name: "Florida–Tennessee" },
  { a: "Ole Miss", b: "Mississippi State", name: "Egg Bowl" },
  { a: "LSU", b: "Arkansas", name: "Battle for the Golden Boot" },
  { a: "LSU", b: "Alabama", name: "LSU–Alabama" },
  { a: "LSU", b: "Texas A&M", name: "LSU–Texas A&M" },
  { a: "Tennessee", b: "Vanderbilt", name: "Tennessee–Vanderbilt" },
  { a: "Kentucky", b: "Louisville", name: "Governor's Cup" },
  { a: "South Carolina", b: "Clemson", name: "Palmetto Bowl" },
  { a: "Missouri", b: "Arkansas", name: "Battle Line Rivalry" },
  { a: "Texas", b: "Oklahoma", name: "Red River Rivalry" },
  { a: "Texas", b: "Texas A&M", name: "Lone Star Showdown" },

  // --- Big Ten ---
  { a: "Ohio State", b: "Michigan", name: "The Game" },
  { a: "Michigan", b: "Michigan State", name: "Paul Bunyan Trophy" },
  { a: "Michigan", b: "Minnesota", name: "Little Brown Jug" },
  { a: "Minnesota", b: "Wisconsin", name: "Paul Bunyan's Axe" },
  { a: "Minnesota", b: "Iowa", name: "Floyd of Rosedale" },
  { a: "Iowa", b: "Iowa State", name: "Cy-Hawk Trophy" },
  { a: "Iowa", b: "Nebraska", name: "Heroes Trophy" },
  { a: "Wisconsin", b: "Nebraska", name: "Freedom Trophy" },
  { a: "Indiana", b: "Purdue", name: "Old Oaken Bucket" },
  { a: "Illinois", b: "Northwestern", name: "Land of Lincoln Trophy" },
  { a: "Illinois", b: "Purdue", name: "Purdue Cannon" },
  { a: "Indiana", b: "Michigan State", name: "Old Brass Spittoon" },
  { a: "Penn State", b: "Michigan State", name: "Land Grant Trophy" },
  { a: "Penn State", b: "Ohio State", name: "Penn State–Ohio State" },
  { a: "Maryland", b: "Rutgers", name: "Maryland–Rutgers" },
  { a: "USC", b: "UCLA", name: "Victory Bell" },
  { a: "USC", b: "Notre Dame", name: "Jeweled Shillelagh" },
  { a: "Oregon", b: "Oregon State", name: "Platypus Trophy" },
  { a: "Oregon", b: "Washington", name: "Oregon–Washington" },
  { a: "Washington", b: "Washington State", name: "Apple Cup" },

  // --- ACC ---
  { a: "Clemson", b: "Georgia Tech", name: "Clemson–Georgia Tech" },
  { a: "Georgia Tech", b: "Georgia", name: "Clean Old-Fashioned Hate" },
  { a: "Florida State", b: "Miami", name: "Florida State–Miami" },
  { a: "Miami", b: "Pittsburgh", name: "Miami–Pittsburgh" },
  { a: "North Carolina", b: "NC State", name: "UNC–NC State" },
  { a: "North Carolina", b: "Duke", name: "Carolina–Duke" },
  { a: "Wake Forest", b: "Duke", name: "Wake Forest–Duke" },
  { a: "Virginia", b: "Virginia Tech", name: "Commonwealth Cup" },
  { a: "Boston College", b: "Syracuse", name: "Boston College–Syracuse" },
  { a: "Louisville", b: "Cincinnati", name: "Keg of Nails" },
  { a: "Pittsburgh", b: "West Virginia", name: "Backyard Brawl" },
  { a: "Stanford", b: "California", name: "Big Game" },
  { a: "Stanford", b: "Notre Dame", name: "Legends Trophy" },

  // --- Big 12 ---
  { a: "Kansas", b: "Kansas State", name: "Sunflower Showdown" },
  { a: "Baylor", b: "TCU", name: "Revivalry" },
  { a: "TCU", b: "SMU", name: "Iron Skillet" },
  { a: "Texas Tech", b: "Baylor", name: "Texas Tech–Baylor" },
  { a: "BYU", b: "Utah", name: "Holy War" },
  { a: "Utah", b: "Utah State", name: "Battle for the Old Wagon Wheel" },
  { a: "Colorado", b: "Colorado State", name: "Rocky Mountain Showdown" },
  { a: "Colorado", b: "Nebraska", name: "Colorado–Nebraska" },
  { a: "Houston", b: "Rice", name: "Bayou Bucket Classic" },
  { a: "Cincinnati", b: "West Virginia", name: "Cincinnati–West Virginia" },

  // --- Service academies ---
  { a: "Army", b: "Navy", name: "Army–Navy Game" },
  { a: "Air Force", b: "Army", name: "Commander-in-Chief's Trophy (AF–Army)" },
  { a: "Air Force", b: "Navy", name: "Commander-in-Chief's Trophy (AF–Navy)" },

  // --- Group of Five ---
  { a: "Toledo", b: "Bowling Green", name: "Battle of I-75" },
  { a: "Ohio", b: "Miami (OH)", name: "Battle of the Bricks" },
  { a: "Akron", b: "Kent State", name: "Wagon Wheel" },
  { a: "Marshall", b: "Southern Miss", name: "Marshall–Southern Miss" },
  { a: "Memphis", b: "Tulane", name: "Memphis–Tulane" },
  { a: "SMU", b: "Houston", name: "SMU–Houston" },
  { a: "Western Kentucky", b: "Middle Tennessee", name: "100 Miles of Hate" },
  { a: "Florida Atlantic", b: "Florida International", name: "Shula Bowl" },
  { a: "New Mexico", b: "New Mexico State", name: "Rio Grande Rivalry" },
  { a: "UTEP", b: "New Mexico State", name: "Battle of I-10" },
  { a: "Nevada", b: "UNLV", name: "Fremont Cannon" },
  { a: "Boise State", b: "Fresno State", name: "Milk Can" },
  { a: "San Diego State", b: "San José State", name: "SDSU–SJSU" },
  { a: "App State", b: "Georgia Southern", name: "Deeper South's Oldest Rivalry" },
  { a: "Georgia Southern", b: "Coastal Carolina", name: "Modern Makeover" },
  { a: "Georgia State", b: "Georgia Southern", name: "Modern Day Hate" },
  { a: "Arizona", b: "Arizona State", name: "Territorial Cup" },
  { a: "UCF", b: "South Florida", name: "War on I-4" },
  { a: "Central Michigan", b: "Western Michigan", name: "Michigan MAC Trophy (CMU–WMU)" },
  { a: "Central Michigan", b: "Eastern Michigan", name: "Michigan MAC Trophy (CMU–EMU)" },
  { a: "Eastern Michigan", b: "Western Michigan", name: "Michigan MAC Trophy (EMU–WMU)" },
  { a: "Louisiana Tech", b: "Southern Miss", name: "Rivalry in Dixie" },
  { a: "Old Dominion", b: "Marshall", name: "Oyster Bowl" },
  { a: "James Madison", b: "App State", name: "James Madison–App State" },
  { a: "North Texas", b: "SMU", name: "Safeway Bowl" },
  { a: "UTSA", b: "Texas State", name: "I-35 Rivalry" },
  { a: "Troy", b: "South Alabama", name: "Battle for the Belt" },
  { a: "Louisiana", b: "UL Monroe", name: "Battle on the Bayou" },
  { a: "Arkansas State", b: "Louisiana", name: "Arkansas State–Louisiana" },
  { a: "Wyoming", b: "Colorado State", name: "Border War (Bronze Boot)" },
];
