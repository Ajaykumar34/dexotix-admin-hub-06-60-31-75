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

    console.log("PhonePe callback received");

    const body = await req.json();
    console.log("Callback body:", JSON.stringify(body, null, 2));

    // Extract data from callback
    const response = body.response;
    const base64Data = response;
    
    // Decode the base64 response
    const decodedData = JSON.parse(atob(base64Data));
    console.log("Decoded callback data:", JSON.stringify(decodedData, null, 2));

    const merchantTransactionId = decodedData.data?.merchantTransactionId;
    const transactionId = decodedData.data?.transactionId;
    const state = decodedData.data?.state;

    if (!merchantTransactionId) {
      throw new Error("Missing merchant transaction ID in callback");
    }

    // Update payment record with callback data
    const { error: paymentUpdateError } = await supabaseClient
      .from("payments")
      .update({
        phonepe_transaction_id: transactionId,
        status: state === "COMPLETED" ? "SUCCESS" : "FAILED",
        callback_data: decodedData,
      })
      .eq("merchant_transaction_id", merchantTransactionId);

    if (paymentUpdateError) {
      console.error("Error updating payment with callback:", paymentUpdateError);
    }

    console.log(`Payment ${merchantTransactionId} updated with status: ${state}`);

    return new Response(
      JSON.stringify({ success: true, status: state }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error processing PhonePe callback:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});