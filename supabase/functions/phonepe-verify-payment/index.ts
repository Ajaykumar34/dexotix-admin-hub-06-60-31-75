import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Get user from auth header
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;

    const { merchantTransactionId, bookingData } = await req.json();

    if (!merchantTransactionId) {
      throw new Error("Merchant transaction ID is required");
    }

    const merchantId = Deno.env.get("PHONEPE_MERCHANT_ID");
    const saltKey = Deno.env.get("PHONEPE_SALT_KEY");
    const saltIndex = Deno.env.get("PHONEPE_SALT_INDEX");

    if (!merchantId || !saltKey || !saltIndex) {
      throw new Error("PhonePe credentials not configured");
    }

    // Create checksum for status check
    const statusEndpoint = `/pg/v1/status/${merchantId}/${merchantTransactionId}`;
    const checksumPayload = statusEndpoint + saltKey;
    const encoder = new TextEncoder();
    const data_to_hash = encoder.encode(checksumPayload);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data_to_hash);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const checksum = hashHex + "###" + saltIndex;

    // Check payment status with PhonePe
    const statusResponse = await fetch(`https://api.phonepe.com/apis/hermes${statusEndpoint}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": checksum,
        "X-MERCHANT-ID": merchantId,
      },
    });

    if (!statusResponse.ok) {
      const errorData = await statusResponse.text();
      console.error("PhonePe status check error:", errorData);
      throw new Error(`PhonePe status check failed: ${statusResponse.status}`);
    }

    const statusData = await statusResponse.json();

    if (!statusData.success || statusData.data?.state !== "COMPLETED") {
      throw new Error("Payment not completed or failed");
    }

    // Log booking data for debugging
    console.log('[PHONEPE-VERIFY] Booking data received:', JSON.stringify(bookingData, null, 2));
    
    // Transform seat numbers to the required format
    const transformedSeatNumbers = Array.isArray(bookingData.seat_numbers) 
      ? bookingData.seat_numbers.map((seat: any) => ({
          price: seat.price || seat.base_price || 0,
          quantity: seat.quantity || "1",
          seat_number: seat.seat_number || seat.id,
          seat_category: seat.seat_category || seat.category || "General",
          total_quantity: "N/A",
          available_quantity: "N/A"
        }))
      : [{
          price: bookingData.total_price || 0,
          quantity: bookingData.quantity?.toString() || "1",
          seat_number: "General",
          seat_category: "General",
          total_quantity: "N/A",
          available_quantity: "N/A"
        }];

    // Create booking in database
    const validBookingFields = {
      user_id: user?.id || null,
      event_id: bookingData.event_id,
      event_occurrence_id: bookingData.event_occurrence_id || null,
      occurrence_ticket_category_id: bookingData.occurrence_ticket_category_id || null,
      quantity: bookingData.quantity,
      total_price: bookingData.total_price,
      convenience_fee: bookingData.convenience_fee || 0,
      customer_name: bookingData.customer_name,
      customer_email: bookingData.customer_email,
      customer_phone: bookingData.customer_phone,
      customer_address: bookingData.customer_address || '',
      customer_state: bookingData.customer_state || '',
      seat_numbers: transformedSeatNumbers,
      booking_metadata: bookingData.booking_metadata || {},
      status: "Confirmed",
    };

    const { data: booking, error: bookingError } = await supabaseClient
      .from("bookings")
      .insert(validBookingFields)
      .select()
      .single();

    if (bookingError) {
      console.error("Error creating booking:", bookingError);
      throw new Error("Failed to create booking");
    }

    // Update payment record
    const { error: paymentUpdateError } = await supabaseClient
      .from("payments")
      .update({
        booking_id: booking.id,
        phonepe_transaction_id: statusData.data.transactionId,
        status: "SUCCESS",
        callback_data: statusData,
        payment_method: statusData.data.paymentInstrument?.type || "UPI",
      })
      .eq("merchant_transaction_id", merchantTransactionId);

    if (paymentUpdateError) {
      console.error("Error updating payment:", paymentUpdateError);
    }

    console.log("PhonePe payment verified and booking created:", booking.id);

    return new Response(
      JSON.stringify({
        success: true,
        booking,
        payment: {
          id: statusData.data.transactionId,
          method: statusData.data.paymentInstrument?.type || "UPI",
          amount: statusData.data.amount / 100, // Convert from paise
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error verifying PhonePe payment:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});