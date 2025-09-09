
import { useState, useEffect } from 'react';

interface GeolocationResult {
  city: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  loading: boolean;
  error: string | null;
  updateCity: (newCity: string) => void;
  detectCity: () => Promise<string | null>;
}

export const useGeolocation = (): GeolocationResult => {
  const [city, setCity] = useState<string | null>(() => {
    return localStorage.getItem('selectedCity') || null;
  });
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reverseGeocode = async (lat: number, lon: number): Promise<string | null> => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`
      );
      
      if (!response.ok) {
        throw new Error('Geocoding failed');
      }
      
      const data = await response.json();
      
      // Extract city from the response with improved priority
      const address = data.address;
      
      // Priority order: city -> town -> village -> state_district -> county -> state
      // We explicitly avoid suburb, neighbourhood, locality to get proper city names
      const detectedCity = 
        address.city ||           // Main city (e.g., "Indore")
        address.town ||           // For smaller towns
        address.village ||        // For villages
        address.state_district || // Administrative district
        address.county ||         // County level
        address.state ||          // State as last resort
        null;
      
      // Clean the city name - remove area prefixes if present
      // Sometimes geocoding returns "Area Name, City Name" format
      const cleanCityName = detectedCity 
        ? detectedCity.split(',').pop()?.trim() || detectedCity
        : null;
      
      console.log('Geocoding response:', { address, detectedCity, cleanCityName });
      
      return cleanCityName;
    } catch (error) {
      console.error('Reverse geocoding error:', error);
      return null;
    }
  };

  const detectCity = async (): Promise<string | null> => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 300000 // 5 minutes cache for better accuracy
        });
      });

      const { latitude, longitude } = position.coords;
      setCoordinates({ latitude, longitude });
      
      console.log('Detected exact coordinates:', { latitude, longitude });
      
      const detectedCity = await reverseGeocode(latitude, longitude);
      
      if (detectedCity) {
        setCity(detectedCity);
        localStorage.setItem('selectedCity', detectedCity);
        localStorage.setItem('detectedCoordinates', JSON.stringify({ latitude, longitude }));
        return detectedCity;
      } else {
        setError('Could not determine city from your exact location');
        return null;
      }
    } catch (error: any) {
      let errorMessage = 'Failed to detect your exact location';
      
      if (error.code === 1) {
        errorMessage = 'Location access denied. Please enable location services and allow precise location access.';
      } else if (error.code === 2) {
        errorMessage = 'Your exact location is unavailable. Please ensure GPS is enabled and try again.';
      } else if (error.code === 3) {
        errorMessage = 'Location request timed out. Please ensure you have a good GPS signal and try again.';
      }
      
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const updateCity = (newCity: string) => {
    setCity(newCity);
    localStorage.setItem('selectedCity', newCity);
    setError(null);
  };

  // Load saved coordinates on initialization
  useEffect(() => {
    const savedCoords = localStorage.getItem('detectedCoordinates');
    if (savedCoords) {
      try {
        setCoordinates(JSON.parse(savedCoords));
      } catch (error) {
        console.error('Failed to parse saved coordinates:', error);
      }
    }
  }, []);

  return { city, coordinates, loading, error, updateCity, detectCity };
};
