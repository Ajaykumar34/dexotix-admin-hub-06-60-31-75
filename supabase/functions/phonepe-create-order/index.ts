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
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    // Get user from auth header
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;

    const { amount, eventId, customerInfo } = await req.json();

    if (!amount || amount <= 0) {
      throw new Error("Valid amount is required");
    }

    const merchantId = Deno.env.get("PHONEPE_MERCHANT_ID");
    const apiKey = Deno.env.get("PHONEPE_API_KEY");
    const saltKey = Deno.env.get("PHONEPE_SALT_KEY");
    const saltIndex = Deno.env.get("PHONEPE_SALT_INDEX");

    if (!merchantId || !apiKey || !saltKey || !saltIndex) {
      throw new Error("PhonePe credentials not configured");
    }

    // Generate unique merchant transaction ID
    const merchantTransactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const userId = user?.id || `guest_${Math.random().toString(36).substr(2, 9)}`;

    // Create PhonePe payment payload
    const paymentPayload = {
      merchantId: merchantId,
      merchantTransactionId: merchantTransactionId,
      merchantUserId: userId,
      amount: Math.round(amount * 100), // Convert to paise
      redirectUrl: `${req.headers.get("origin")}/payment-success`,
      redirectMode: "REDIRECT",
      callbackUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/phonepe-callback`,
      mobileNumber: customerInfo?.phone || "",
      paymentInstrument: {
        type: "PAY_PAGE"
      }
    };

    // Create base64 encoded payload
    const base64Payload = btoa(JSON.stringify(paymentPayload));
    
    // Create checksum
    const checksumPayload = base64Payload + "/pg/v1/pay" + saltKey;
    const encoder = new TextEncoder();
    const data_to_hash = encoder.encode(checksumPayload);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data_to_hash);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const checksum = hashHex + "###" + saltIndex;

    // Make API call to PhonePe
    const phonePeResponse = await fetch("https://api.phonepe.com/apis/hermes/pg/v1/pay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": checksum,
      },
      body: JSON.stringify({
        request: base64Payload
      }),
    });

    if (!phonePeResponse.ok) {
      const errorData = await phonePeResponse.text();
      console.error("PhonePe API error:", errorData);
      throw new Error(`PhonePe API error: ${phonePeResponse.status}`);
    }

    const phonepeData = await phonePeResponse.json();

    // Store payment record in database
    const { error: paymentError } = await supabaseClient
      .from("payments")
      .insert({
        merchant_transaction_id: merchantTransactionId,
        amount: amount,
        status: "PENDING",
        payment_method: "UPI",
        response_data: phonepeData,
      });

    if (paymentError) {
      console.error("Error storing payment:", paymentError);
    }

    console.log("PhonePe order created:", merchantTransactionId);

    return new Response(
      JSON.stringify({
        success: phonepeData.success,
        code: phonepeData.code,
        message: phonepeData.message,
        data: phonepeData.data,
        merchantTransactionId: merchantTransactionId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error creating PhonePe order:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});