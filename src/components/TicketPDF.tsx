
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { supabase } from '@/integrations/supabase/client';
import { generateInvoiceNumber } from '@/utils/invoiceUtils';

interface TicketData {
  booking: {
    id: string;
    quantity: number;
    total_price: number;
    booking_date: string;
    convenience_fee?: number;
    event_occurrence_id?: string;
    occurrence_ticket_category_id?: string;
    seat_numbers?: Array<{
      price: number;
      seat_number: string;
      seat_category: string;
    }> | null;
  };
  event: {
    name: string;
    start_datetime: string;
    venue?: {
      name: string;
      city: string;
      address: string;
    } | null;
    category?: string;
    sub_category?: string;
    genre?: string;
    genres?: string[];
    language?: string;
    duration?: number;
    tags?: string[];
    artist_name?: string;
    artists?: Array<{
      name: string;
      image?: string;
    }>;
    is_recurring?: boolean;
    event_time?: string;
  };
  customerInfo: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  selectedSeats?: any[];
  totalPrice: number;
  basePrice: number;
  convenienceFee: number;
  formattedBookingId?: string;
  selectedGeneralTickets?: Array<{
    categoryId: string;
    categoryName: string;
    quantity: number;
    basePrice: number;
    convenienceFee: number;
    totalPrice: number;
  }>;
  eventOccurrenceId?: string;
}

interface BackendPricing {
  basePrice: number;
  convenienceFee: number;
  gstAmount: number;
  totalPrice: number;
  actualTotalQuantity?: number;
  categoryBreakdown?: Array<{
    category: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  customerData?: {
    name: string;
    email: string;
    phone: string;
  };
  occurrenceData?: {
    occurrence_date: string;
    occurrence_time: string;
  };
  eventTime?: string;
}

// Enhanced pricing data fetch for recurring events with occurrence-specific data
const fetchPricingData = async (bookingId: string): Promise<BackendPricing | null> => {
  try {
    console.log('Fetching pricing data for booking:', bookingId);
    
    // Get booking with detailed information including occurrence data
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        *,
        events!inner(
          id,
          name,
          category,
          is_recurring,
          event_time
        ),
        event_occurrences(
          id,
          occurrence_date,
          occurrence_time
        ),
        occurrence_ticket_categories(
          id,
          category_name,
          base_price,
          convenience_fee,
          commission
        )
      `)
      .eq('id', bookingId)
      .single();

    if (bookingError) {
      console.error('Error fetching booking:', bookingError);
      return null;
    }

    if (!booking) {
      console.error('No booking found for ID:', bookingId);
      return null;
    }

    console.log('Fetched booking data for PDF pricing:', booking);

    // Extract basic booking data
    const totalPrice = booking.total_price || 0;
    const totalConvenienceFee = booking.convenience_fee || 0;
    const quantity = booking.quantity || 1;

    console.log('Raw booking data for convenience fee:', {
      totalPrice,
      totalConvenienceFee,
      quantity,
      bookingConvenienceFee: booking.convenience_fee
    });

    // For seat map events, fetch detailed pricing from event_seat_pricing table
    let seatPricingData = null;
    let isGeneralAdmission = false;
    
    // Check if this is a seat map event with seat_numbers
    if (booking.seat_numbers && Array.isArray(booking.seat_numbers) && booking.seat_numbers.length > 0) {
      console.log('Fetching seat pricing data for seat map event');
      const { data: seatPricing, error: seatPricingError } = await supabase
        .from('event_seat_pricing')
        .select(`
          id,
          seat_category_id,
          base_price,
          convenience_fee,
          convenience_fee_type,
          convenience_fee_value,
          commission,
          commission_type,
          commission_value,
          seat_categories (
            id,
            name
          )
        `)
        .eq('event_id', booking.event_id)
        .eq('is_active', true);
      
      if (!seatPricingError && seatPricing) {
        seatPricingData = seatPricing;
        console.log('Fetched seat pricing data:', seatPricingData);
      }
    } else {
      isGeneralAdmission = true;
    }

    // Calculate convenience fee breakdown (total includes 18% GST)
    let convenienceFeeBase = 0;
    let gstAmount = 0;
    
    if (totalConvenienceFee > 0) {
      convenienceFeeBase = totalConvenienceFee / 1.18;
      gstAmount = totalConvenienceFee - convenienceFeeBase;
    } else {
      // If no convenience fee in booking, check if we can calculate from occurrence category
      if (booking.occurrence_ticket_categories && booking.occurrence_ticket_categories.convenience_fee > 0) {
        const categoryConvFee = booking.occurrence_ticket_categories.convenience_fee * quantity;
        convenienceFeeBase = categoryConvFee / 1.18;
        gstAmount = categoryConvFee - convenienceFeeBase;
      }
    }

    // Calculate base price (total - convenience fee with GST)
    const totalConvFeeWithGst = convenienceFeeBase + gstAmount;
    const basePrice = totalPrice - totalConvFeeWithGst;

    console.log('Calculated convenience fee breakdown:', {
      totalConvenienceFee,
      convenienceFeeBase,
      gstAmount,
      totalConvFeeWithGst,
      basePrice
    });

    let categoryBreakdown: Array<{
      category: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }> = [];

    let occurrenceData = null;
    if (booking.event_occurrences) {
      occurrenceData = {
        occurrence_date: booking.event_occurrences.occurrence_date,
        occurrence_time: booking.event_occurrences.occurrence_time
      };
    }

    // Handle category breakdown based on booking type
    if (booking.occurrence_ticket_categories) {
      // Recurring event with specific category
      const category = booking.occurrence_ticket_categories;
      categoryBreakdown.push({
        category: category.category_name,
        quantity: quantity,
        unitPrice: category.base_price,
        totalPrice: category.base_price * quantity
      });
    } else if (booking.seat_numbers && Array.isArray(booking.seat_numbers)) {
      // Process seat_numbers for category breakdown with enhanced pricing calculation
      const categoryMap = new Map<string, { quantity: number; totalPrice: number; unitPrice: number; convenienceFee: number }>();
      
      booking.seat_numbers.forEach((seat: any) => {
        const categoryName = seat.seat_category || seat.category || 'General';
        const seatPrice = seat.price || seat.base_price || 0;
        let seatQuantity = 1;
        
        if (seat.quantity) {
          seatQuantity = typeof seat.quantity === 'string' ? parseInt(seat.quantity, 10) : seat.quantity;
        }
        
        // Find pricing data for this seat category
        let categoryConvenienceFee = 0;
        if (seatPricingData) {
          const pricing = seatPricingData.find(p => p.seat_categories?.name === categoryName);
          if (pricing) {
            if (pricing.convenience_fee_type && pricing.convenience_fee_value !== undefined) {
              if (pricing.convenience_fee_type === 'percentage') {
                categoryConvenienceFee = (seatPrice * pricing.convenience_fee_value) / 100;
              } else {
                categoryConvenienceFee = pricing.convenience_fee_value;
              }
            } else if (pricing.convenience_fee !== undefined) {
              categoryConvenienceFee = pricing.convenience_fee;
            }
          }
        }
        
        if (!categoryMap.has(categoryName)) {
          categoryMap.set(categoryName, { 
            quantity: 0, 
            totalPrice: 0, 
            unitPrice: seatPrice, 
            convenienceFee: categoryConvenienceFee 
          });
        }
        
        const current = categoryMap.get(categoryName)!;
        current.quantity += seatQuantity;
        current.totalPrice += seatPrice * seatQuantity;
      });

      // Recalculate convenience fee breakdown for seat map events
      if (seatPricingData && convenienceFeeBase === 0 && totalConvenienceFee === 0) {
        let totalCalculatedConvFee = 0;
        categoryMap.forEach((data, categoryName) => {
          totalCalculatedConvFee += data.convenienceFee * data.quantity;
        });
        
        if (totalCalculatedConvFee > 0) {
          // Assume convenience fee includes 18% GST
          convenienceFeeBase = totalCalculatedConvFee / 1.18;
          gstAmount = totalCalculatedConvFee - convenienceFeeBase;
        }
      }

      categoryMap.forEach((data, categoryName) => {
        categoryBreakdown.push({
          category: categoryName,
          quantity: data.quantity,
          unitPrice: data.unitPrice,
          totalPrice: data.totalPrice
        });
      });
    } else {
      // Fallback: Single general category
      categoryBreakdown.push({
        category: 'General',
        quantity: quantity,
        unitPrice: basePrice / quantity,
        totalPrice: basePrice
      });
    }

    const result: BackendPricing = {
      basePrice,
      convenienceFee: convenienceFeeBase,
      gstAmount,
      totalPrice,
      categoryBreakdown,
      actualTotalQuantity: quantity,
      customerData: {
        name: booking.customer_name || '',
        email: booking.customer_email || '',
        phone: booking.customer_phone || ''
      },
      occurrenceData,
      eventTime: booking.events?.event_time
    };

    console.log('Final calculated pricing for PDF:', result);
    return result;
    
  } catch (error) {
    console.error('Error in fetchPricingData:', error);
    return null;
  }
};

// Compact single-page configuration
const getSinglePageConfig = (pageWidth: number, pageHeight: number) => {
  return {
    margin: 10,
    headerHeight: 25,
    fontSize: {
      title: 16,
      subtitle: 10,
      heading: 12,
      body: 9,
      small: 8
    },
    lineHeight: 4,
    sectionSpacing: 8,
    qrSize: 40,
    contentPadding: 3,
    maxTextWidth: pageWidth * 0.85
  };
};

// Helper function to add text with word wrapping but no page breaks
const addCompactText = (doc: jsPDF, text: string, x: number, y: number, maxWidth: number, fontSize: number) => {
  doc.setFontSize(fontSize);
  const lines = doc.splitTextToSize(text, maxWidth);
  let currentY = y;
  
  (Array.isArray(lines) ? lines : [lines]).forEach((line: string) => {
    doc.text(line, x, currentY);
    currentY += 4; // Fixed compact line height
  });
  
  return currentY;
};

// Compact ticket breakdown for single page
const displayCompactTicketBreakdown = (doc: jsPDF, ticketData: TicketData, backendPricing: BackendPricing | null, rightColumnX: number, rightColumnWidth: number, currentY: number, config: any) => {
  const isGeneralAdmission = !ticketData.selectedSeats || ticketData.selectedSeats.length === 0;
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Tickets', rightColumnX, currentY);
  
  currentY += 10;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  
  if (isGeneralAdmission) {
    doc.text('Type:', rightColumnX, currentY);
    currentY += 5;
    
    const categoryParts: string[] = [];
    
    if (ticketData.event.is_recurring && backendPricing && backendPricing.categoryBreakdown && backendPricing.categoryBreakdown.length > 0) {
      backendPricing.categoryBreakdown.forEach((category) => {
        categoryParts.push(`${category.category} × ${category.quantity}`);
      });
    } else if (ticketData.selectedGeneralTickets && ticketData.selectedGeneralTickets.length > 0) {
      ticketData.selectedGeneralTickets.forEach((ticket) => {
        categoryParts.push(`${ticket.categoryName} × ${ticket.quantity}`);
      });
    } else if (ticketData.booking.seat_numbers && Array.isArray(ticketData.booking.seat_numbers)) {
      const categoryMap = new Map<string, number>();
      ticketData.booking.seat_numbers.forEach((seat: any) => {
        const category = seat.seat_category || seat.category || 'General';
        let quantity = 1;
        if (seat.quantity) {
          quantity = typeof seat.quantity === 'string' ? parseInt(seat.quantity, 10) : seat.quantity;
        } else if (seat.booked_quantity) {
          quantity = typeof seat.booked_quantity === 'string' ? parseInt(seat.booked_quantity, 10) : seat.booked_quantity;
        }
        categoryMap.set(category, (categoryMap.get(category) || 0) + quantity);
      });
      categoryMap.forEach((quantity, category) => {
        categoryParts.push(`${category} × ${quantity}`);
      });
    } else {
      categoryParts.push(`General × ${ticketData.booking.quantity}`);
    }
    
    const ticketSummary = categoryParts.join(', ');
    currentY = addCompactText(doc, ticketSummary, rightColumnX, currentY, rightColumnWidth, 9);
    currentY += 5;
    
  } else {
    const seatsByCategory = new Map<string, string[]>();
    
    if (ticketData.selectedSeats && ticketData.selectedSeats.length > 0) {
      ticketData.selectedSeats.forEach(seat => {
        const category = seat.seat_categories?.name || seat.category_name || seat.category || 'General';
        const seatNumber = `${seat.row_name || ''}${seat.seat_number}`;
        
        if (!seatsByCategory.has(category)) {
          seatsByCategory.set(category, []);
        }
        seatsByCategory.get(category)!.push(seatNumber);
      });
    } else if (ticketData.booking.seat_numbers) {
      ticketData.booking.seat_numbers.forEach(seat => {
        const category = seat.seat_category || 'General';
        if (!seatsByCategory.has(category)) {
          seatsByCategory.set(category, []);
        }
        seatsByCategory.get(category)!.push(seat.seat_number);
      });
    }
    
    const categoryParts: string[] = [];
    seatsByCategory.forEach((seats, category) => {
      categoryParts.push(`${category}: ${seats.join(', ')}`);
    });
    
    const seatsDisplayText = categoryParts.join(' ');
    currentY = addCompactText(doc, seatsDisplayText, rightColumnX, currentY, rightColumnWidth, 9);
  }
  
  currentY += 8;
  
  let totalSeats = ticketData.booking.quantity;
  if (backendPricing && backendPricing.actualTotalQuantity) {
    totalSeats = backendPricing.actualTotalQuantity;
  } else if (backendPricing && backendPricing.categoryBreakdown) {
    totalSeats = backendPricing.categoryBreakdown.reduce((sum, category) => sum + category.quantity, 0);
  } else if (ticketData.selectedGeneralTickets) {
    totalSeats = ticketData.selectedGeneralTickets.reduce((sum, ticket) => sum + ticket.quantity, 0);
  }
  
  doc.text('Total:', rightColumnX, currentY);
  doc.text(totalSeats.toString(), rightColumnX + 25, currentY);
  
  return currentY + 8;
};

export const generateTicketPDF = async (ticketData: TicketData & { eventOccurrenceId?: string }) => {
  console.log('Generating single-page PDF for booking:', ticketData.booking.id);

  const isCombinedBooking = (ticketData.booking as any).is_combined || false;
  const combinedBookingIds = (ticketData.booking as any).combined_booking_ids || [];

  const backendPricing = await fetchPricingData(ticketData.booking.id);
  console.log('Backend pricing data for PDF:', backendPricing);
  
  let customerInfo = ticketData.customerInfo;
  
  if (backendPricing?.customerData && backendPricing.customerData.name) {
    const fullName = backendPricing.customerData.name.trim();
    console.log('Full name from booking data:', fullName);
    
    const nameParts = fullName.split(' ').filter(part => part.length > 0);
    let firstName = '';
    let lastName = '';
    
    if (nameParts.length === 1) {
      firstName = nameParts[0];
      lastName = '';
    } else if (nameParts.length >= 2) {
      firstName = nameParts[0];
      lastName = nameParts.slice(1).join(' ');
    }
    
    customerInfo = {
      firstName: firstName,
      lastName: lastName,
      email: backendPricing.customerData.email || ticketData.customerInfo.email,
      phone: backendPricing.customerData.phone || ticketData.customerInfo.phone
    };
  }
  
  const formattedBookingId = await generateInvoiceNumber(ticketData.booking.booking_date, ticketData.booking.id);
  console.log('Generated formatted booking ID for PDF:', formattedBookingId);

  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  
  const config = getSinglePageConfig(pageWidth, pageHeight);
  
  const yellowColor: [number, number, number] = [255, 255, 0];
  const blackColor: [number, number, number] = [0, 0, 0];
  
  const contentWidth = pageWidth - (config.margin * 2);
  const leftColumnX = config.margin + config.contentPadding;
  const rightColumnX = pageWidth * 0.55;
  const leftColumnWidth = (pageWidth * 0.55) - config.margin - (config.contentPadding * 2);
  const rightColumnWidth = pageWidth * 0.45 - config.margin - config.contentPadding;
  
  // Compact header
  doc.setFillColor(...yellowColor);
  doc.rect(config.margin, 10, contentWidth, config.headerHeight, 'F');
  
  doc.setTextColor(...blackColor);
  doc.setFontSize(config.fontSize.title);
  doc.setFont('helvetica', 'bold');
  doc.text('TICKETOOZ.COM', leftColumnX, 22);
  
  doc.setFontSize(config.fontSize.subtitle);
  doc.setFont('helvetica', 'normal');
  const ticketTypeText = isCombinedBooking ? 'Your Combined Event Tickets' : 'Your Event Ticket';
  doc.text(ticketTypeText, leftColumnX, 30);
  
  // Main content starts at Y=40
  let currentY = 40;
  
  // Event Details Section - Left Column
  doc.setFontSize(config.fontSize.heading);
  doc.setFont('helvetica', 'bold');
  doc.text('Event Details', leftColumnX, currentY);
  
  currentY += config.sectionSpacing;
  doc.setFontSize(config.fontSize.body);
  doc.setFont('helvetica', 'normal');
  
  doc.text('Event:', leftColumnX, currentY);
  currentY += config.lineHeight;
  currentY = addCompactText(doc, ticketData.event.name || 'Event Name', leftColumnX, currentY, leftColumnWidth, config.fontSize.body);
  currentY += config.lineHeight;
  
  doc.text('Date & Time:', leftColumnX, currentY);
  
  let eventDate: Date;
  let dateStr: string;
  let timeStr: string;
  
  if (ticketData.event.is_recurring && backendPricing?.occurrenceData) {
    const occurrenceDate = new Date(backendPricing.occurrenceData.occurrence_date);
    dateStr = occurrenceDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    
    const eventTime = backendPricing.eventTime || ticketData.event.event_time;
    if (eventTime) {
      const [hours, minutes] = eventTime.split(':').map(Number);
      const timeDate = new Date();
      timeDate.setHours(hours, minutes, 0, 0);
      
      timeStr = timeDate.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true
      });
    } else {
      const occurrenceDateTime = `${backendPricing.occurrenceData.occurrence_date}T${backendPricing.occurrenceData.occurrence_time}`;
      eventDate = new Date(occurrenceDateTime);
      timeStr = eventDate.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true
      });
    }
  } else {
    eventDate = new Date(ticketData.event.start_datetime);
    dateStr = eventDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    timeStr = eventDate.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true
    });
  }
  
  currentY = addCompactText(doc, `${dateStr} at ${timeStr}`, leftColumnX, currentY + config.lineHeight, leftColumnWidth, config.fontSize.body);
  currentY += config.lineHeight;
  
  doc.text('Venue:', leftColumnX, currentY);
  currentY += config.lineHeight;
  currentY = addCompactText(doc, ticketData.event.venue?.name || 'TBA', leftColumnX, currentY, leftColumnWidth, config.fontSize.body);
  currentY += config.lineHeight;
  
  doc.text('Address:', leftColumnX, currentY);
  currentY += config.lineHeight;
  currentY = addCompactText(doc, ticketData.event.venue?.address || 'TBA', leftColumnX, currentY, leftColumnWidth, config.fontSize.body);
  
  // Ticket Information - Right Column (starts at Y=40)
  const ticketY = displayCompactTicketBreakdown(doc, ticketData, backendPricing, rightColumnX, rightColumnWidth, 40, config);
  
  // Customer Information - Left Column continues
  currentY += config.sectionSpacing;
  
  doc.setFontSize(config.fontSize.heading);
  doc.setFont('helvetica', 'bold');
  doc.text('Customer Information', leftColumnX, currentY);
  
  currentY += config.sectionSpacing;
  doc.setFontSize(config.fontSize.body);
  doc.setFont('helvetica', 'normal');
  
  doc.text('Name:', leftColumnX, currentY);
  currentY += config.lineHeight;
  
  const firstName = customerInfo.firstName || '';
  const lastName = customerInfo.lastName || '';
  const fullName = `${firstName}${lastName ? ' ' + lastName : ''}`.trim();
  
  if (fullName) {
    currentY = addCompactText(doc, fullName, leftColumnX, currentY, leftColumnWidth, config.fontSize.body);
  } else {
    currentY = addCompactText(doc, 'Guest User', leftColumnX, currentY, leftColumnWidth, config.fontSize.body);
  }
  currentY += config.lineHeight;

  doc.text('Email:', leftColumnX, currentY);
  currentY += config.lineHeight;
  currentY = addCompactText(doc, customerInfo.email, leftColumnX, currentY, leftColumnWidth, config.fontSize.body);
  currentY += config.lineHeight;
  
  doc.text('Phone:', leftColumnX, currentY);
  currentY = addCompactText(doc, customerInfo.phone, leftColumnX, currentY + config.lineHeight, leftColumnWidth, config.fontSize.body);
  currentY += config.lineHeight * 2;
  
  // Booking ID
  if (isCombinedBooking && combinedBookingIds.length > 0) {
    doc.text('Combined Booking IDs:', leftColumnX, currentY);
    currentY += config.lineHeight;
    for (let index = 0; index < combinedBookingIds.length; index++) {
      const id = combinedBookingIds[index];
      const formattedCombinedId = await generateInvoiceNumber(ticketData.booking.booking_date, id);
      const shortId = formattedCombinedId.slice(0, 20) + (formattedCombinedId.length > 20 ? '...' : '');
      currentY = addCompactText(doc, `${index + 1}. ${shortId}`, leftColumnX, currentY, leftColumnWidth, config.fontSize.body);
    }
  } else {
    doc.text('Booking ID:', leftColumnX, currentY);
    currentY += config.lineHeight;
    currentY = addCompactText(doc, formattedBookingId, leftColumnX, currentY, leftColumnWidth, config.fontSize.body);
  }

  // Payment Summary - Left Column (moved from right column)
  currentY += config.sectionSpacing * 2;
  
  doc.setFontSize(config.fontSize.heading);
  doc.setFont('helvetica', 'bold');
  doc.text('Payment Summary', leftColumnX, currentY);
  
  currentY += config.sectionSpacing;
  doc.setFontSize(config.fontSize.body);
  doc.setFont('helvetica', 'normal');
  
  if (backendPricing) {
    if (backendPricing.categoryBreakdown && backendPricing.categoryBreakdown.length > 0) {
      backendPricing.categoryBreakdown.forEach((category) => {
        doc.text(`${category.category} (×${category.quantity}):`, leftColumnX, currentY);
        doc.text(`₹${category.totalPrice.toFixed(2)}`, leftColumnX + 55, currentY);
        currentY += config.lineHeight + 1;
      });
    } else {
      doc.text(`Tickets (×${ticketData.booking.quantity}):`, leftColumnX, currentY);
      doc.text(`₹${backendPricing.basePrice.toFixed(2)}`, leftColumnX + 55, currentY);
      currentY += config.lineHeight + 1;
    }
    
    // Always show convenience fee breakdown even if 0
    const totalConvenienceFee = (backendPricing.convenienceFee || 0) + (backendPricing.gstAmount || 0);
    
    if (totalConvenienceFee > 0) {
      // Show breakdown: Base convenience fee + GST
      doc.text('Convenience Fee (Base):', leftColumnX, currentY);
      doc.text(`₹${(backendPricing.convenienceFee || 0).toFixed(2)}`, leftColumnX + 65, currentY);
      currentY += config.lineHeight + 1;
      
      doc.text('GST on Conv. Fee (18%):', leftColumnX, currentY);
      doc.text(`₹${(backendPricing.gstAmount || 0).toFixed(2)}`, leftColumnX + 65, currentY);
      currentY += config.lineHeight + 1;
      
      // Show total convenience fee
      doc.setFont('helvetica', 'bold');
      doc.text('Total Conv. Fee:', leftColumnX, currentY);
      doc.text(`₹${totalConvenienceFee.toFixed(2)}`, leftColumnX + 65, currentY);
      doc.setFont('helvetica', 'normal');
      currentY += config.lineHeight + 1;
    } else {
      doc.text('Convenience Fee:', leftColumnX, currentY);
      doc.text('₹0.00', leftColumnX + 65, currentY);
      currentY += config.lineHeight + 1;
    }
    
    doc.setFont('helvetica', 'bold');
    doc.text('Total Amount:', leftColumnX, currentY);
    doc.text(`₹${backendPricing.totalPrice.toFixed(2)}`, leftColumnX + 55, currentY);
  } else {
    const totalPrice = ticketData.totalPrice;
    const convenienceFee = ticketData.convenienceFee || ticketData.booking.convenience_fee || 0;
    const basePrice = totalPrice - convenienceFee;
    
    console.log('Fallback payment calculation:', {
      totalPrice,
      convenienceFee,
      basePrice,
      bookingConvenienceFee: ticketData.booking.convenience_fee
    });
    
    doc.text(`Tickets (×${ticketData.booking.quantity}):`, leftColumnX, currentY);
    doc.text(`₹${basePrice.toFixed(2)}`, leftColumnX + 65, currentY);
    currentY += config.lineHeight + 1;
    
    if (convenienceFee > 0) {
      const convenienceFeeBeforeGst = convenienceFee / 1.18;
      const gstAmount = convenienceFee - convenienceFeeBeforeGst;
      
      doc.text('Convenience Fee (Base):', leftColumnX, currentY);
      doc.text(`₹${convenienceFeeBeforeGst.toFixed(2)}`, leftColumnX + 65, currentY);
      currentY += config.lineHeight + 1;
      
      doc.text('GST on Conv. Fee (18%):', leftColumnX, currentY);
      doc.text(`₹${gstAmount.toFixed(2)}`, leftColumnX + 65, currentY);
      currentY += config.lineHeight + 1;
      
      // Show total convenience fee
      doc.setFont('helvetica', 'bold');
      doc.text('Total Conv. Fee:', leftColumnX, currentY);
      doc.text(`₹${convenienceFee.toFixed(2)}`, leftColumnX + 65, currentY);
      doc.setFont('helvetica', 'normal');
      currentY += config.lineHeight + 1;
    } else {
      doc.text('Convenience Fee:', leftColumnX, currentY);
      doc.text('₹0.00', leftColumnX + 65, currentY);
      currentY += config.lineHeight + 1;
    }
    
    doc.setFont('helvetica', 'bold');
    doc.text('Total Amount:', leftColumnX, currentY);
    doc.text(`₹${totalPrice.toFixed(2)}`, leftColumnX + 65, currentY);
  }
  
  // QR Code - Right Column
  const qrY = Math.max(ticketY, 120);
  
  const verificationUrl = `${window.location.origin}/verify-ticket/${formattedBookingId}`;
  console.log('Generated QR verification URL:', verificationUrl);
  
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, {
      width: config.qrSize * 3,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    doc.addImage(qrCodeDataUrl, 'PNG', rightColumnX, qrY, config.qrSize, config.qrSize);
    doc.setFontSize(config.fontSize.small);
    doc.setFont('helvetica', 'normal');
    doc.text('Scan to verify', rightColumnX, qrY + config.qrSize + 5);
    
  } catch (error) {
    console.error('Failed to generate QR code:', error);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(1);
    doc.rect(rightColumnX, qrY, config.qrSize, config.qrSize);
    
    doc.setFontSize(config.fontSize.small);
    doc.setFont('helvetica', 'bold');
    doc.text('QR Code', rightColumnX + config.qrSize/2 - 12, qrY + config.qrSize/2 + 2);
    doc.text('Error', rightColumnX + config.qrSize/2 - 8, qrY + config.qrSize/2 + 8);
  }
  
  // Important Notices - Bottom of page
  const noticesY = pageHeight - 35;
  
  doc.setFontSize(config.fontSize.subtitle);
  doc.setFont('helvetica', 'bold');
  doc.text('IMPORTANT NOTICES:', leftColumnX, noticesY);
  
  let noticeY = noticesY + 5;
  doc.setFontSize(config.fontSize.small);
  doc.setFont('helvetica', 'normal');
  
  const notices = [
    '• Please bring this ticket and valid ID',
    '• Entry subject to security check',
    '• No refunds or exchanges allowed',
    '• Support: support@ticketooz.com'
  ];
  
  notices.forEach(notice => {
    doc.text(notice, leftColumnX, noticeY);
    noticeY += 3;
  });
  
  doc.save(`ticket-${formattedBookingId}.pdf`);
};
