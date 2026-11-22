import type { LocationCategory } from './catalog.js';

export interface MapillaryWorldSeed {
  id: string;
  city: string;
  country: string;
  region: string;
  lat: number;
  lng: number;
  categories: LocationCategory[];
}

/**
 * 56 global cities + 17 global mountain regions with strong Mapillary 360° street coverage.
 */
export const MAPILLARY_WORLD_SEEDS: MapillaryWorldSeed[] = [
  // Western & Southern Europe
  { id: 'paris', city: 'Paris', country: 'France', region: 'Western Europe', lat: 48.8566, lng: 2.3522, categories: ['big_city'] },
  { id: 'lyon', city: 'Lyon', country: 'France', region: 'Western Europe', lat: 45.764, lng: 4.8357, categories: ['big_city'] },
  { id: 'london', city: 'London', country: 'United Kingdom', region: 'Western Europe', lat: 51.5074, lng: -0.1278, categories: ['big_city'] },
  { id: 'edinburgh', city: 'Edinburgh', country: 'United Kingdom', region: 'Western Europe', lat: 55.9533, lng: -3.1883, categories: ['big_city'] },
  { id: 'dublin', city: 'Dublin', country: 'Ireland', region: 'Western Europe', lat: 53.3498, lng: -6.2603, categories: ['big_city'] },
  { id: 'amsterdam', city: 'Amsterdam', country: 'Netherlands', region: 'Western Europe', lat: 52.3676, lng: 4.9041, categories: ['big_city'] },
  { id: 'brussels', city: 'Brussels', country: 'Belgium', region: 'Western Europe', lat: 50.8503, lng: 4.3517, categories: ['big_city'] },
  { id: 'berlin', city: 'Berlin', country: 'Germany', region: 'Central Europe', lat: 52.52, lng: 13.405, categories: ['big_city'] },
  { id: 'munich', city: 'Munich', country: 'Germany', region: 'Central Europe', lat: 48.1351, lng: 11.582, categories: ['big_city'] },
  { id: 'zurich', city: 'Zurich', country: 'Switzerland', region: 'Central Europe', lat: 47.3769, lng: 8.5417, categories: ['big_city'] },
  { id: 'vienna', city: 'Vienna', country: 'Austria', region: 'Central Europe', lat: 48.2082, lng: 16.3738, categories: ['big_city'] },
  { id: 'prague', city: 'Prague', country: 'Czechia', region: 'Central Europe', lat: 50.0755, lng: 14.4378, categories: ['big_city'] },
  { id: 'warsaw', city: 'Warsaw', country: 'Poland', region: 'Central Europe', lat: 52.2297, lng: 21.0122, categories: ['big_city'] },
  { id: 'madrid', city: 'Madrid', country: 'Spain', region: 'Southern Europe', lat: 40.4168, lng: -3.7038, categories: ['big_city'] },
  { id: 'barcelona', city: 'Barcelona', country: 'Spain', region: 'Southern Europe', lat: 41.3874, lng: 2.1686, categories: ['big_city'] },
  { id: 'lisbon', city: 'Lisbon', country: 'Portugal', region: 'Southern Europe', lat: 38.7223, lng: -9.1393, categories: ['big_city'] },
  { id: 'rome', city: 'Rome', country: 'Italy', region: 'Southern Europe', lat: 41.9028, lng: 12.4964, categories: ['big_city'] },
  { id: 'milan', city: 'Milan', country: 'Italy', region: 'Southern Europe', lat: 45.4642, lng: 9.19, categories: ['big_city'] },
  { id: 'athens', city: 'Athens', country: 'Greece', region: 'Southern Europe', lat: 37.9838, lng: 23.7275, categories: ['big_city'] },
  // Northern & Eastern Europe
  { id: 'stockholm', city: 'Stockholm', country: 'Sweden', region: 'Northern Europe', lat: 59.3293, lng: 18.0686, categories: ['big_city'] },
  { id: 'oslo', city: 'Oslo', country: 'Norway', region: 'Northern Europe', lat: 59.9139, lng: 10.7522, categories: ['big_city'] },
  { id: 'copenhagen', city: 'Copenhagen', country: 'Denmark', region: 'Northern Europe', lat: 55.6761, lng: 12.5683, categories: ['big_city'] },
  { id: 'helsinki', city: 'Helsinki', country: 'Finland', region: 'Northern Europe', lat: 60.1699, lng: 24.9384, categories: ['big_city'] },
  { id: 'reykjavik', city: 'Reykjavik', country: 'Iceland', region: 'Northern Europe', lat: 64.1466, lng: -21.9426, categories: ['big_city'] },
  { id: 'tallinn', city: 'Tallinn', country: 'Estonia', region: 'Northern Europe', lat: 59.437, lng: 24.7536, categories: ['big_city'] },
  { id: 'riga', city: 'Riga', country: 'Latvia', region: 'Northern Europe', lat: 56.9496, lng: 24.1052, categories: ['big_city'] },
  { id: 'budapest', city: 'Budapest', country: 'Hungary', region: 'Central Europe', lat: 47.4979, lng: 19.0402, categories: ['big_city'] },
  { id: 'bucharest', city: 'Bucharest', country: 'Romania', region: 'Eastern Europe', lat: 44.4268, lng: 26.1025, categories: ['big_city'] },
  { id: 'istanbul', city: 'Istanbul', country: 'Turkey', region: 'Eurasia', lat: 41.0082, lng: 28.9784, categories: ['big_city'] },
  // North America
  { id: 'nyc', city: 'New York City', country: 'United States', region: 'North America', lat: 40.7484, lng: -73.9857, categories: ['big_city'] },
  { id: 'sf', city: 'San Francisco', country: 'United States', region: 'North America', lat: 37.7749, lng: -122.4194, categories: ['big_city'] },
  { id: 'chicago', city: 'Chicago', country: 'United States', region: 'North America', lat: 41.8781, lng: -87.6298, categories: ['big_city'] },
  { id: 'seattle', city: 'Seattle', country: 'United States', region: 'North America', lat: 47.6062, lng: -122.3321, categories: ['big_city'] },
  { id: 'boston', city: 'Boston', country: 'United States', region: 'North America', lat: 42.3601, lng: -71.0589, categories: ['big_city'] },
  { id: 'austin', city: 'Austin', country: 'United States', region: 'North America', lat: 30.2672, lng: -97.7431, categories: ['big_city'] },
  { id: 'la', city: 'Los Angeles', country: 'United States', region: 'North America', lat: 34.0522, lng: -118.2437, categories: ['big_city'] },
  { id: 'toronto', city: 'Toronto', country: 'Canada', region: 'North America', lat: 43.6532, lng: -79.3832, categories: ['big_city'] },
  { id: 'vancouver', city: 'Vancouver', country: 'Canada', region: 'North America', lat: 49.2827, lng: -123.1207, categories: ['big_city'] },
  { id: 'montreal', city: 'Montreal', country: 'Canada', region: 'North America', lat: 45.5017, lng: -73.5673, categories: ['big_city'] },
  { id: 'mexico-city', city: 'Mexico City', country: 'Mexico', region: 'North America', lat: 19.4326, lng: -99.1332, categories: ['big_city'] },
  // South America
  { id: 'bogota', city: 'Bogota', country: 'Colombia', region: 'South America', lat: 4.711, lng: -74.0721, categories: ['big_city'] },
  { id: 'sao-paulo', city: 'Sao Paulo', country: 'Brazil', region: 'South America', lat: -23.5505, lng: -46.6333, categories: ['big_city'] },
  { id: 'rio', city: 'Rio de Janeiro', country: 'Brazil', region: 'South America', lat: -22.9068, lng: -43.1729, categories: ['big_city'] },
  { id: 'buenos-aires', city: 'Buenos Aires', country: 'Argentina', region: 'South America', lat: -34.6037, lng: -58.3816, categories: ['big_city'] },
  { id: 'santiago', city: 'Santiago', country: 'Chile', region: 'South America', lat: -33.4489, lng: -70.6693, categories: ['big_city'] },
  { id: 'lima', city: 'Lima', country: 'Peru', region: 'South America', lat: -12.0464, lng: -77.0428, categories: ['big_city'] },
  // Asia
  { id: 'tokyo', city: 'Tokyo', country: 'Japan', region: 'East Asia', lat: 35.6762, lng: 139.6503, categories: ['big_city'] },
  { id: 'osaka', city: 'Osaka', country: 'Japan', region: 'East Asia', lat: 34.6937, lng: 135.5023, categories: ['big_city'] },
  { id: 'taipei', city: 'Taipei', country: 'Taiwan', region: 'East Asia', lat: 25.033, lng: 121.5654, categories: ['big_city'] },
  { id: 'singapore', city: 'Singapore', country: 'Singapore', region: 'Southeast Asia', lat: 1.3521, lng: 103.8198, categories: ['big_city'] },
  { id: 'bangkok', city: 'Bangkok', country: 'Thailand', region: 'Southeast Asia', lat: 13.7563, lng: 100.5018, categories: ['big_city'] },
  { id: 'jakarta', city: 'Jakarta', country: 'Indonesia', region: 'Southeast Asia', lat: -6.2088, lng: 106.8456, categories: ['big_city'] },
  // Oceania & Africa
  { id: 'sydney', city: 'Sydney', country: 'Australia', region: 'Oceania', lat: -33.8688, lng: 151.2093, categories: ['big_city'] },
  { id: 'melbourne', city: 'Melbourne', country: 'Australia', region: 'Oceania', lat: -37.8136, lng: 144.9631, categories: ['big_city'] },
  { id: 'auckland', city: 'Auckland', country: 'New Zealand', region: 'Oceania', lat: -36.8485, lng: 174.7633, categories: ['big_city'] },
  { id: 'cape-town', city: 'Cape Town', country: 'South Africa', region: 'Southern Africa', lat: -33.9249, lng: 18.4241, categories: ['big_city'] },
  // Global Mountain Regions (17 authentic mountain-region seeds)
  { id: 'grindelwald', city: 'Grindelwald', country: 'Switzerland', region: 'Central Europe', lat: 46.6242, lng: 8.0414, categories: ['mountain'] },
  { id: 'chamonix', city: 'Chamonix-Mont-Blanc', country: 'France', region: 'Western Europe', lat: 45.9237, lng: 6.8694, categories: ['mountain'] },
  { id: 'courmayeur', city: 'Courmayeur', country: 'Italy', region: 'Southern Europe', lat: 45.7969, lng: 6.9686, categories: ['mountain'] },
  { id: 'cortina-dolomites', city: "Cortina d'Ampezzo", country: 'Italy', region: 'Southern Europe', lat: 46.5405, lng: 12.1357, categories: ['mountain'] },
  { id: 'banff', city: 'Banff', country: 'Canada', region: 'North America', lat: 51.1784, lng: -115.5708, categories: ['mountain'] },
  { id: 'estes-park', city: 'Estes Park', country: 'United States', region: 'North America', lat: 40.3772, lng: -105.5217, categories: ['mountain'] },
  { id: 'cusco', city: 'Cusco', country: 'Peru', region: 'South America', lat: -13.5319, lng: -71.9675, categories: ['mountain'] },
  { id: 'bariloche', city: 'San Carlos de Bariloche', country: 'Argentina', region: 'South America', lat: -41.1335, lng: -71.3103, categories: ['mountain'] },
  { id: 'puerto-natales', city: 'Puerto Natales', country: 'Chile', region: 'South America', lat: -51.7263, lng: -72.5062, categories: ['mountain'] },
  { id: 'queenstown', city: 'Queenstown', country: 'New Zealand', region: 'Oceania', lat: -45.0312, lng: 168.6626, categories: ['mountain'] },
  { id: 'geiranger', city: 'Geiranger', country: 'Norway', region: 'Northern Europe', lat: 62.1008, lng: 7.2058, categories: ['mountain'] },
  { id: 'hakone', city: 'Hakone', country: 'Japan', region: 'East Asia', lat: 35.2324, lng: 139.1069, categories: ['mountain'] },
  { id: 'takayama', city: 'Takayama', country: 'Japan', region: 'East Asia', lat: 36.1461, lng: 137.2522, categories: ['mountain'] },
  { id: 'andorra-la-vella', city: 'Andorra la Vella', country: 'Andorra', region: 'Western Europe', lat: 42.5063, lng: 1.5218, categories: ['mountain'] },
  { id: 'stepantsminda', city: 'Stepantsminda', country: 'Georgia', region: 'Eurasia', lat: 42.6594, lng: 44.6431, categories: ['mountain'] },
  { id: 'sinaia', city: 'Sinaia', country: 'Romania', region: 'Eastern Europe', lat: 45.35, lng: 25.55, categories: ['mountain'] },
  { id: 'fort-william', city: 'Fort William', country: 'United Kingdom', region: 'Western Europe', lat: 56.8198, lng: -5.1052, categories: ['mountain'] },
];
