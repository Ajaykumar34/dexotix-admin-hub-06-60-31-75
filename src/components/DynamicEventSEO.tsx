import { useEffect } from 'react';
import { useSEO } from '@/hooks/useSEO';

interface EventSEOProps {
  event: {
    id: string;
    name: string;
    description?: string;
    category?: string;
    venue_name?: string;
    city?: string;
    state?: string;
    start_date?: string;
    start_time?: string;
    end_date?: string;
    end_time?: string;
    image_url?: string;
    price_range?: string;
    performer_name?: string;
    address?: string;
    postal_code?: string;
    ticket_price_min?: number;
    ticket_price_max?: number;
    artists?: Array<{ name: string }>;
    venues?: {
      name: string;
      city: string;
      state?: string;
      address?: string;
      postal_code?: string;
    };
  };
}

const DynamicEventSEO = ({ event }: EventSEOProps) => {
  const formatEventDateTime = (date: string, time?: string) => {
    if (!date) return null;
    const dateTime = time ? `${date}T${time}` : `${date}T00:00:00`;
    return new Date(dateTime).toISOString();
  };

  const startDateTime = formatEventDateTime(event.start_date || '', event.start_time);
  const endDateTime = formatEventDateTime(event.end_date || '', event.end_time);

  const eventStructuredData = {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": event.name,
    "startDate": startDateTime,
    "endDate": endDateTime,
    "eventStatus": "https://schema.org/EventScheduled",
    "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
    "location": {
      "@type": "Place",
      "name": event.venues?.name || event.venue_name || "Venue TBA",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": event.venues?.address || event.address || "",
        "addressLocality": event.venues?.city || event.city || "",
        "addressRegion": event.venues?.state || event.state || "",
        "postalCode": event.venues?.postal_code || event.postal_code || "",
        "addressCountry": "IN"
      }
    },
    "image": event.image_url ? [event.image_url] : ["https://ticketooz.com/assets/ticketooz-og-image.jpg"],
    "description": event.description || `Join us for ${event.name}`,
    "offers": {
      "@type": "Offer",
      "url": `https://ticketooz.com/event/${event.id}`,
      "price": event.ticket_price_min || event.price_range || "TBA",
      "priceCurrency": "INR",
      "availability": "https://schema.org/InStock",
      "validFrom": new Date().toISOString()
    },
    "performer": event.artists?.length ? event.artists.map(artist => ({
      "@type": "Person",
      "name": artist.name
    })) : (event.performer_name ? {
      "@type": "Person",
      "name": event.performer_name
    } : undefined),
    "organizer": {
      "@type": "Organization",
      "name": "TicketooZ",
      "url": "https://ticketooz.com"
    }
  };

  const eventDate = event.start_date ? new Date(event.start_date).toLocaleDateString('en-IN', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  }) : 'TBA';

  const venueName = event.venues?.name || event.venue_name || 'Venue TBA';
  const cityName = event.venues?.city || event.city || 'TBA';

  const seoConfig = {
    title: `${event.name} - Book Tickets | TicketooZ`,
    description: `Book tickets for ${event.name} on ${eventDate} at ${venueName}. ${event.description ? event.description.substring(0, 150) + (event.description.length > 150 ? '...' : '') : 'Amazing event experience awaits you.'} Secure booking with instant confirmation on TicketooZ.`,
    keywords: `${event.name}, ${event.category || 'event'}, ${venueName}, ${cityName}, book tickets, event booking, ${eventDate}, book ${event.category || 'event'} tickets, ${event.category || 'event'} tickets online, ${event.category?.toLowerCase() || 'event'} booking, drama tickets, concert tickets, sports tickets, comedy show tickets, dance performance tickets, theatre tickets, entertainment tickets`,
    ogType: 'event' as const,
    ogImage: event.image_url || 'https://ticketooz.com/assets/ticketooz-og-image.jpg',
    canonical: `https://ticketooz.com/event/${event.id}`,
    structuredData: eventStructuredData,
    additionalMeta: [
      { name: 'event:start_time', content: startDateTime || '' },
      { name: 'event:end_time', content: endDateTime || '' },
      { name: 'event:location', content: `${venueName}, ${cityName}` }
    ]
  };

  useSEO(seoConfig);

  return null;
};

export default DynamicEventSEO;