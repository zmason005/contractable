"use strict";

/**
 * proper-nouns.js
 *
 * JS port of tools/proper_nouns.py. Case-insensitive lookup sets for
 * filtering countries, demonyms/nationalities, US states, major cities,
 * and common surnames out of word-import candidates.
 *
 * Keep this in sync with tools/proper_nouns.py -- it is a manual port,
 * not generated, so any update to the Python source needs to be mirrored
 * here by hand.
 */

const COUNTRIES = new Set([
  "afghanistan", "albania", "algeria", "andorra", "angola", "argentina",
  "armenia", "australia", "austria", "azerbaijan", "bahamas", "bahrain",
  "bangladesh", "barbados", "belarus", "belgium", "belize", "benin",
  "bhutan", "bolivia", "bosnia", "botswana", "brazil", "brunei", "bulgaria",
  "burundi", "cambodia", "cameroon", "canada", "chad", "chile", "china",
  "colombia", "comoros", "congo", "croatia", "cuba", "cyprus", "denmark",
  "djibouti", "dominica", "ecuador", "egypt", "eritrea", "estonia",
  "eswatini", "ethiopia", "fiji", "finland", "france", "gabon", "gambia",
  "georgia", "germany", "ghana", "greece", "grenada", "guatemala", "guinea",
  "guyana", "haiti", "honduras", "hungary", "iceland", "india", "indonesia",
  "iran", "iraq", "ireland", "israel", "italy", "jamaica", "japan", "jordan",
  "kazakhstan", "kenya", "kiribati", "kosovo", "kuwait", "laos", "latvia",
  "lebanon", "lesotho", "liberia", "libya", "liechtenstein", "lithuania",
  "luxembourg", "madagascar", "malawi", "malaysia", "maldives", "mali",
  "malta", "mauritania", "mauritius", "mexico", "micronesia", "moldova",
  "monaco", "mongolia", "montenegro", "morocco", "mozambique", "myanmar",
  "namibia", "nauru", "nepal", "netherlands", "nicaragua", "niger",
  "nigeria", "norway", "oman", "pakistan", "palau", "panama", "paraguay",
  "peru", "philippines", "poland", "portugal", "qatar", "romania", "russia",
  "rwanda", "samoa", "senegal", "serbia", "seychelles", "singapore",
  "slovakia", "slovenia", "somalia", "spain", "sudan", "suriname", "sweden",
  "switzerland", "syria", "taiwan", "tajikistan", "tanzania", "thailand",
  "togo", "tonga", "tunisia", "turkey", "turkmenistan", "tuvalu", "uganda",
  "ukraine", "uruguay", "uzbekistan", "vanuatu", "venezuela", "vietnam",
  "yemen", "zambia", "zimbabwe"
]);

const DEMONYMS = new Set([
  "afghan", "albanian", "algerian", "american", "andorran", "angolan",
  "argentine", "argentinean", "armenian", "australian", "austrian",
  "azerbaijani", "bahamian", "bahraini", "bangladeshi", "barbadian",
  "belarusian", "belgian", "belizean", "beninese", "bhutanese", "bolivian",
  "bosnian", "botswanan", "brazilian", "british", "bruneian", "bulgarian",
  "burmese", "burundian", "cambodian", "cameroonian", "canadian", "chadian",
  "chilean", "chinese", "colombian", "congolese", "croatian", "cuban",
  "cypriot", "czech", "danish", "djiboutian", "dominican", "dutch",
  "ecuadorian", "egyptian", "emirati", "eritrean", "estonian", "ethiopian",
  "fijian", "filipino", "finnish", "french", "gabonese", "gambian",
  "georgian", "german", "ghanaian", "greek", "grenadian", "guatemalan",
  "guinean", "guyanese", "haitian", "honduran", "hungarian", "icelandic",
  "indian", "indonesian", "iranian", "iraqi", "irish", "israeli", "italian",
  "jamaican", "japanese", "jordanian", "kazakh", "kenyan", "korean",
  "kuwaiti", "laotian", "latvian", "lebanese", "liberian", "libyan",
  "liechtensteiner", "lithuanian", "luxembourgish", "macedonian", "malagasy",
  "malawian", "malaysian", "maldivian", "malian", "maltese", "mauritanian",
  "mauritian", "mexican", "moldovan", "monacan", "mongolian", "montenegrin",
  "moroccan", "mozambican", "namibian", "nepalese", "nepali", "nicaraguan",
  "nigerian", "nigerien", "norwegian", "omani", "pakistani", "panamanian",
  "paraguayan", "peruvian", "philippine", "polish", "portuguese", "qatari",
  "romanian", "russian", "rwandan", "samoan", "saudi", "scottish",
  "senegalese", "serbian", "singaporean", "slovak", "slovenian", "somali",
  "spanish", "sudanese", "swedish", "swiss", "syrian", "taiwanese", "tajik",
  "tanzanian", "thai", "togolese", "tongan", "tunisian", "turkish",
  "turkmen", "ugandan", "ukrainian", "uruguayan", "uzbek", "venezuelan",
  "vietnamese", "welsh", "yemeni", "zambian", "zimbabwean"
]);

const US_STATES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
  "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "ohio", "oklahoma", "oregon",
  "pennsylvania", "tennessee", "texas", "utah", "vermont", "virginia",
  "washington", "wisconsin", "wyoming"
]);

const CITIES_AND_CAPITALS = new Set([
  "beijing", "berlin", "boston", "brighton", "cairo", "chicago", "dallas",
  "dayton", "denver", "detroit", "dubai", "dublin", "hartford", "houston",
  "lisbon", "london", "madrid", "miami", "milan", "moscow", "munich",
  "nairobi", "newark", "oakland", "omaha", "ottawa", "paris", "phoenix",
  "prague", "rome", "seattle", "tampa", "tokyo", "toronto", "tulsa",
  "vienna", "warsaw"
]);

const SURNAMES = new Set([
  "adams", "alexander", "allen", "anderson", "andrews", "armstrong",
  "arnold", "bailey", "baker", "barnes", "bell", "bennett", "berry", "black",
  "bradley", "brooks", "brown", "bryant", "burns", "butler", "campbell",
  "carroll", "carter", "castro", "chavez", "clark", "cole", "coleman",
  "collins", "cook", "cooper", "cox", "crawford", "cunningham", "daniels",
  "davis", "diaz", "dixon", "duncan", "dunn", "edwards", "elliott", "ellis",
  "evans", "ferguson", "fisher", "fleming", "flores", "ford", "foster",
  "fox", "freeman", "garcia", "gardner", "garza", "gibson", "gonzalez",
  "gordon", "graham", "grant", "gray", "green", "griffin", "gutierrez",
  "hall", "hamilton", "hansen", "harris", "harrison", "hart", "hawkins",
  "hayes", "henderson", "henry", "hernandez", "herrera", "hicks", "hill",
  "hoffman", "holmes", "howard", "hudson", "hughes", "hunt", "hunter",
  "jackson", "james", "jenkins", "jimenez", "johns", "johnson", "jones",
  "jordan", "kelley", "kelly", "kennedy", "kim", "king", "knight", "lane",
  "lee", "lewis", "long", "lopez", "marshall", "martin", "martinez", "mason",
  "mcdonald", "medina", "mendez", "mendoza", "meyer", "mills", "mitchell",
  "moore", "morales", "moreno", "morgan", "morris", "murphy", "murray",
  "myers", "nelson", "nguyen", "nichols", "olson", "ortiz", "owens",
  "palmer", "parker", "patterson", "payne", "perez", "perkins", "perry",
  "peters", "peterson", "phillips", "pierce", "porter", "potter", "powell",
  "price", "ramirez", "ramos", "ray", "reed", "reyes", "reynolds", "rice",
  "richardson", "riley", "rivera", "roberts", "robertson", "robinson",
  "rodriguez", "rogers", "romero", "rose", "ross", "ruiz", "russell", "ryan",
  "salazar", "sanchez", "sanders", "santos", "schmidt", "scott", "shaw",
  "silva", "simmons", "simpson", "smith", "snyder", "soto", "spencer",
  "stephens", "stevens", "stewart", "stone", "sullivan", "taylor", "thomas",
  "thompson", "torres", "tran", "tucker", "turner", "vargas", "vasquez",
  "vazquez", "wagner", "walker", "wallace", "ward", "warren", "washington",
  "watson", "weaver", "webb", "wells", "west", "white", "williams", "wilson",
  "wood", "woods", "wright", "young"
]);

const ALL_PROPER_NOUNS = new Set([
  ...COUNTRIES,
  ...DEMONYMS,
  ...US_STATES,
  ...CITIES_AND_CAPITALS,
  ...SURNAMES,
]);

/**
 * Case-insensitive check. `word` may be any case; comparison is
 * always done lowercased against the pre-lowercased sets above.
 */
function isProperNoun(word) {
  return ALL_PROPER_NOUNS.has(String(word).trim().toLowerCase());
}

module.exports = { isProperNoun, ALL_PROPER_NOUNS };
