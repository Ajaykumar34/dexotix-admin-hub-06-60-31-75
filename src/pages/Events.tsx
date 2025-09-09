
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Filter, Search } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import Navbar from '@/components/Navbar';
import CategoryList from '@/components/CategoryList';
import PublicEventCard from '@/components/PublicEventCard';
import { usePublicEvents, isEventPast } from '@/hooks/usePublicEvents';
import { useCategories } from '@/hooks/useCategories';
import { useSubcategories } from '@/hooks/useSubcategories';
import { useVenues } from '@/hooks/useVenues';
import { useSEO, seoConfigs } from '@/hooks/useSEO';

const Events = () => {
  // Apply SEO configuration
  useSEO(seoConfigs.events);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCity, setSelectedCity] = useState(() => {
    return localStorage.getItem('selectedCity') || '';
  });
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSubcategory, setSelectedSubcategory] = useState('');
  const [selectedVenue, setSelectedVenue] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [priceRange, setPriceRange] = useState('all');

  const { events, loading: eventsLoading } = usePublicEvents();
  const { categories, loading: categoriesLoading } = useCategories();
  const { subcategories, loading: subcategoriesLoading } = useSubcategories(selectedCategory);
  const { venues } = useVenues();

  const cities = [...new Set(events.map(event => event.city).filter(Boolean))];
  const languages = [...new Set(events.map(event => event.language).filter(Boolean))];

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    setSelectedSubcategory(''); // Reset subcategory when category changes
  };

  const handleCategoryChange = (value: string) => {
    const category = value === 'all' ? '' : value;
    setSelectedCategory(category);
    setSelectedSubcategory(''); // Reset subcategory when category changes
  };

  const handleSubcategoryChange = (value: string) => {
    setSelectedSubcategory(value === 'all' ? '' : value);
  };

  const handleCityChange = (city: string) => {
    setSelectedCity(city);
    localStorage.setItem('selectedCity', city);
    setSelectedVenue('');
  };

  const handleClearFilters = () => {
    setSearchTerm('');
    setSelectedCategory('');
    setSelectedSubcategory('');
    setPriceRange('all');
    setSelectedCity('');
    setSelectedVenue('');
    setSelectedDate(undefined);
    setSelectedLanguage('');
    localStorage.removeItem('selectedCity');
  };

  // Filter venues based on selected city
  const filteredVenues = selectedCity 
    ? venues.filter(venue => venue.city === selectedCity)
    : venues;

  // Apply filters - show only non-expired events
  const filteredEvents = events.filter(event => {
    // Exclude expired events
    if (isEventPast(event)) return false;
    
    const matchesSearch =
      event.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      event.category?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCity = !selectedCity || event.city === selectedCity;
    
    // Fix category matching - use event.category directly instead of event.categories?.name
    const matchesCategory = selectedCategory === '' || event.category === selectedCategory;
    
    // Fix subcategory matching - use event.sub_category directly
    const matchesSubcategory = selectedSubcategory === '' || event.sub_category === selectedSubcategory;
    
    const matchesVenue = !selectedVenue || event.venue_id === selectedVenue;
    const matchesLanguage = !selectedLanguage || event.language === selectedLanguage;
    
    const matchesDate = !selectedDate || 
      new Date(event.start_datetime).toDateString() === selectedDate.toDateString();
    
    const matchesPrice = priceRange === 'all' ||
      (priceRange === 'under1000' && (event.price || 0) < 1000) ||
      (priceRange === '1000-5000' && (event.price || 0) >= 1000 && (event.price || 0) <= 5000) ||
      (priceRange === 'above5000' && (event.price || 0) > 5000);

    return matchesSearch && matchesCity && matchesCategory && matchesSubcategory && 
           matchesVenue && matchesLanguage && matchesDate && matchesPrice;
  });

  const hasActiveFilters = selectedCategory || selectedSubcategory || selectedCity || 
                          selectedVenue || selectedDate || selectedLanguage || priceRange !== 'all';

  if (eventsLoading || categoriesLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar onSearch={setSearchTerm} />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="text-center py-12">
            <div className="text-lg">Loading events...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar onSearch={setSearchTerm} />
      
      <CategoryList 
        onCategorySelect={handleCategorySelect} 
        selectedCategory={selectedCategory}
        categories={categories}
      />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex gap-6">
          {/* Left Sidebar - Filters */}
          <div className="w-72 flex-shrink-0">
            <div className="bg-white rounded-lg shadow-sm p-6 sticky top-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-2">
                  <Filter className="w-5 h-5 text-gray-500" />
                  <h3 className="text-lg font-semibold">Filters</h3>
                </div>
                {hasActiveFilters && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={handleClearFilters}
                    className="text-blue-600 hover:text-blue-700 p-0"
                  >
                    Clear All
                  </Button>
                )}
              </div>

              <div className="space-y-6">
                {/* Search */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">
                    Search Events
                  </Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input
                      placeholder="Search events..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                {/* Category Filter */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">
                    Category
                  </Label>
                  <Select 
                    value={selectedCategory || 'all'} 
                    onValueChange={handleCategoryChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories.map(category => (
                        <SelectItem key={category.id} value={category.name}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Subcategory Filter - Only show when category is selected */}
                {selectedCategory && (
                  <div>
                    <Label className="text-sm font-medium text-gray-700 mb-2 block">
                      Subcategory
                    </Label>
                    <Select 
                      value={selectedSubcategory || 'all'} 
                      onValueChange={handleSubcategoryChange}
                      disabled={subcategoriesLoading}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={subcategoriesLoading ? "Loading..." : "All Subcategories"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Subcategories</SelectItem>
                        {subcategories.map(subcategory => (
                          <SelectItem key={subcategory.id} value={subcategory.name}>
                            {subcategory.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* City Filter */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">
                    City
                  </Label>
                  <Select 
                    value={selectedCity || 'all'} 
                    onValueChange={(value) => handleCityChange(value === 'all' ? '' : value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="All Cities" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Cities</SelectItem>
                      {cities.map(city => (
                        <SelectItem key={city} value={city}>{city}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Venue Filter */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">
                    Venue
                  </Label>
                  <Select 
                    value={selectedVenue || 'all'} 
                    onValueChange={(value) => setSelectedVenue(value === 'all' ? '' : value)}
                    disabled={!selectedCity}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={!selectedCity ? "Select City First" : "All Venues"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Venues</SelectItem>
                      {filteredVenues.map(venue => (
                        <SelectItem key={venue.id} value={venue.id}>{venue.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Date Filter */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">
                    Date
                  </Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !selectedDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {selectedDate ? format(selectedDate, "PPP") : <span>Any Date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={setSelectedDate}
                        disabled={(date) => date < new Date()}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Language Filter */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">
                    Language
                  </Label>
                  <Select 
                    value={selectedLanguage || 'all'} 
                    onValueChange={(value) => setSelectedLanguage(value === 'all' ? '' : value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="All Languages" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Languages</SelectItem>
                      {languages.map(language => (
                        <SelectItem key={language} value={language}>{language}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Price Range Filter */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">
                    Price Range
                  </Label>
                  <Select value={priceRange} onValueChange={setPriceRange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Price Range" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Prices</SelectItem>
                      <SelectItem value="under1000">Under ₹1,000</SelectItem>
                      <SelectItem value="1000-5000">₹1,000 - ₹5,000</SelectItem>
                      <SelectItem value="above5000">Above ₹5,000</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1">
            {/* Event Stats */}
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Results:</strong> {filteredEvents.length} events found
                {selectedCategory && ` • Category: ${selectedCategory}`}
                {selectedSubcategory && ` • Subcategory: ${selectedSubcategory}`}
                {selectedCity && ` • City: ${selectedCity}`}
                {selectedVenue && ` • Venue: ${venues.find(v => v.id === selectedVenue)?.name}`}
                {searchTerm && ` • Search: "${searchTerm}"`}
              </p>
            </div>

            {/* Events Grid */}
            {filteredEvents.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredEvents.map((event) => (
                  <PublicEventCard key={event.id} event={event} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-gray-500 text-lg mb-4">
                  {events.length === 0 
                    ? "No events available at the moment." 
                    : "No events found matching your criteria."
                  }
                </div>
                <div className="text-sm text-gray-400 mb-4">
                  Try adjusting your filters or search terms.
                </div>
                {hasActiveFilters && (
                  <Button 
                    variant="outline" 
                    onClick={handleClearFilters}
                  >
                    Clear All Filters
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Events;
