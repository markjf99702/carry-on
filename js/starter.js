// The list someone starts with if they don't bring their own. It goes in untouched (model.js), so it
// gives way to a list from another device. Each line: name, then | conditions, then | per-day, then | a note.
// The power bank's note is the airlines' rule: spare lithium batteries, power banks included, go in a carry-on and
// never in a checked bag (TSA, "What can I bring? Power banks", read October 2026).
const BAGS = [
  ['liquids', '🧴', 'Liquids bag', 'bag', 'Bottles 3.4 oz (100 ml) or less, in one quart bag, for a carry-on.', `
    Toothpaste
    Shampoo and conditioner
    Deodorant
    Face wash
    Moisturizer
    Sunscreen | sun hot swim
    Contact lens solution`],
  ['toiletries', '🪥', 'Toiletries bag', 'bag', '', `
    Toothbrush
    Floss
    Razor
    Hairbrush or comb
    Nail clippers
    Lip balm
    Glasses or contacts
    Prescriptions | | | In your carry-on when flying, in case a bag goes missing
    Pain reliever`],
  ['electronics', '🔌', 'Electronics', 'bag', '', `
    Phone charger
    Headphones
    Laptop and charger
    Watch charger
    Power bank | | | Carry-on only when flying, never a checked bag
    Car charger | drive
    Plug adapter | plug`],
  ['documents', '🛂', 'Documents and money', 'bag', '', `
    Wallet
    Keys
    ID
    Passport | abroad
    Boarding pass or tickets | fly train
    Credit cards
    Health insurance card
    Some local cash | abroad`],
  ['clothes', '👕', 'Clothes', 'bag', '', `
    Underwear | | day
    Socks | | day
    Shirts | | day
    Pants or shorts
    Pajamas
    Shoes
    Belt
    Swimsuit | swim hot
    Sandals | hot swim
    Sun hat | hot sun
    Workout clothes | gym
    Something dressy | dressy
    Light jacket | cool
    Warm coat | cold
    Gloves and hat | cold
    Rain jacket | rain
    Hiking boots | outdoors
    Snow boots | snow`],
  ['daybag', '🎒', 'Day bag', 'bag', '', `
    Sunglasses
    Water bottle
    Umbrella | rain
    Snacks
    Book or e-reader
    Eye mask and earplugs | fly train
    Neck pillow | fly
    Bug spray | outdoors`],
  ['work', '💼', 'Work bag', 'bag', 'work', `
    Badge
    Notebook and pen
    Business cards`],
  ['leave', '🏠', 'Leaving the house', 'leave', '', `
    Take out the trash
    Set the thermostat
    Water the plants
    Chargers out of the wall
    Anything in the fridge
    Lock the windows and doors`],
  ['back', '🏨', 'Leaving the hotel', 'back', '', `
    Chargers out of the outlets
    The safe and the drawers
    The fridge and the hooks on the doors
    The bathroom and the shower
    Under the bed and in the closet`],
];

export function starterList() {
  const bags = [], items = [];
  for (const [id, icon, name, kind, extra, lines] of BAGS) {
    // For bags, the fifth field is a note, or for the work bag its condition.
    const isCond = extra === 'work';
    bags.push({ id: 's-' + id, name, icon, kind, when: isCond ? [extra] : [], unless: [], note: isCond ? '' : extra });
    for (const line of lines.trim().split('\n')) {
      const [n, when = '', per = '', note = ''] = line.split('|').map(s => s.trim());
      const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      items.push({ id: `s-${id}-${slug}`.slice(0, 48), name: n, bag: 's-' + id, when: when ? when.split(/\s+/) : [], unless: [], qty: 1, per: per === 'day' ? 'day' : '', note });
    }
  }
  return { bags, items, tags: [] };
}
