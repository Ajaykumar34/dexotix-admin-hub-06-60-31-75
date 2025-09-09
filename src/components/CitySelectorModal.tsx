import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MapPin, Navigation, Search } from 'lucide-react';
import { useGeolocation } from '@/hooks/useGeolocation';
import { supabase } from '@/integrations/supabase/client';

interface CitySelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCitySelect: (city: string) => void;
  selectedCity: string;
}

const popularCities = [
  { name: 'Mumbai', icon: '🏙️' },
  { name: 'Delhi', icon: '🏛️' },
  { name: 'Bengaluru', icon: '🏢' },
  { name: 'Chennai', icon: '🏛️' },
  { name: 'Kolkata', icon: '🏛️' },
  { name: 'Kochi', icon: '🏝️' },
  { name: 'Thane', icon: '🏘️' }
];

const CitySelectorModal = ({ isOpen, onClose, onCitySelect, selectedCity }: CitySelectorModalProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [availableCities, setAvailableCities] = useState<string[]>([]);
  const [loadingCities, setLoadingCities] = useState(true);

  useEffect(() => {
    const fetchCities = async () => {
      try {
        setLoadingCities(true);
        
        // Get cities from venues
        const { data: venuesData } = await supabase
          .from('venues')
          .select('city')
          .not('city', 'is', null);

        // Get cities from events
        const { data: eventsData } = await supabase
          .from('events')
          .select(`venues!inner(city)`)
          .eq('status', 'active');

        // Combine and deduplicate cities
        const venueCities = venuesData?.map(v => v.city).filter(Boolean) || [];
        const eventCities = eventsData?.map(e => e.venues?.city).filter(Boolean) || [];
        
        const allCities = [...new Set([...venueCities, ...eventCities])].sort();
        setAvailableCities(allCities);
      } catch (error) {
        console.error('Error fetching cities:', error);
      } finally {
        setLoadingCities(false);
      }
    };

    if (isOpen) {
      fetchCities();
    }
  }, [isOpen]);

  const handleCitySelect = (city: string) => {
    onCitySelect(city);
    onClose();
  };

  const filteredCities = availableCities.filter(city =>
    city.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Show popular cities that exist in our venues
  const availablePopularCities = popularCities.filter(popular => 
    availableCities.some(city => city.toLowerCase() === popular.name.toLowerCase())
  );

  const otherCities = filteredCities.filter(city => 
    !availablePopularCities.some(popular => 
      popular.name.toLowerCase() === city.toLowerCase()
    )
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="sr-only">Select Your City</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <Input
              placeholder="Search for your city"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 py-3 text-lg"
            />
          </div>


          <div className="max-h-96 overflow-y-auto space-y-6">
            {/* Popular Cities - only show if we have venue data */}
            {!searchTerm && availablePopularCities.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-4 text-center">Popular Cities</h3>
                <div className="grid grid-cols-5 gap-4">
                  {availablePopularCities.map((city) => {
                    const matchingCity = availableCities.find(c => 
                      c.toLowerCase() === city.name.toLowerCase()
                    );
                    
                    return (
                      <button
                        key={city.name}
                        onClick={() => handleCitySelect(matchingCity!)}
                        className="flex flex-col items-center p-3 hover:bg-gray-50 rounded-lg transition-colors"
                      >
                        <div className="text-3xl mb-2">{city.icon}</div>
                        <span className="text-sm text-gray-700 text-center">{city.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Other Cities */}
            <div>
              <h3 className="text-lg font-semibold mb-4 text-center">
                {searchTerm ? 'Search Results' : 'Other Cities'}
              </h3>
              
              {loadingCities ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  <p className="mt-2 text-gray-600">Loading cities...</p>
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-2 text-sm">
                  {(searchTerm ? filteredCities : otherCities).map((city) => (
                    <button
                      key={city}
                      onClick={() => handleCitySelect(city)}
                      className="text-left p-2 hover:bg-gray-50 rounded text-gray-600 hover:text-gray-800 transition-colors"
                    >
                      {city}
                    </button>
                  ))}
                </div>
              )}
              
              {!loadingCities && filteredCities.length === 0 && searchTerm && (
                <div className="text-center py-8 text-gray-500">
                  No cities found matching "{searchTerm}"
                </div>
              )}
            </div>

            {!searchTerm && availableCities.length > 0 && (
              <div className="text-center">
                <button
                  onClick={() => handleCitySelect('all_cities')}
                  className="text-red-500 hover:text-red-600 font-medium"
                >
                  Show all cities
                </button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CitySelectorModal;
