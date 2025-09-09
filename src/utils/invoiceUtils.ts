
import { supabase } from '@/integrations/supabase/client';

export const generateInvoiceNumber = async (createdAt: string, bookingId?: string): Promise<string> => {
  // Extract date components from createdAt
  const date = new Date(createdAt);
  const year = date.getFullYear().toString().slice(-2); // Last 2 digits of year
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const monthKey = `${year}${month}`;
  
  try {
    // First, try to get the current counter for this month from the database
    // We'll use a simple approach with the bookings table to count existing invoices
    const { data: existingBookings, error } = await supabase
      .from('bookings')
      .select('id, created_at')
      .gte('created_at', `${date.getFullYear()}-${month}-01`)
      .lt('created_at', `${date.getFullYear()}-${String(parseInt(month) + 1).padStart(2, '0')}-01`)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching bookings for invoice counter:', error);
      // Fallback to timestamp-based unique number
      const timestamp = date.getTime();
      const uniquePart = timestamp.toString().slice(-4);
      return `INV-${year}${month}-${uniquePart}`;
    }

    // Calculate the incremental number based on existing bookings + 1
    const incrementalNumber = (existingBookings?.length || 0) + 1;
    const formattedNumber = incrementalNumber.toString().padStart(4, '0');
    
    return `INV-${year}${month}-${formattedNumber}`;
  } catch (error) {
    console.error('Error generating invoice number:', error);
    // Fallback to timestamp-based unique number
    const timestamp = date.getTime();
    const uniquePart = timestamp.toString().slice(-4);
    return `INV-${year}${month}-${uniquePart}`;
  }
};
