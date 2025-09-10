
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3';
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendOTPRequest {
  email: string;
  purpose: 'registration' | 'password_reset' | 'email_change';
  user_id?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, purpose, user_id }: SendOTPRequest = await req.json();

    console.log('Received OTP request:', { email, purpose });

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Set expiration time (10 minutes from now)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    console.log('Generated OTP:', otpCode);

    // Store OTP in database
    const { error: dbError } = await supabaseClient
      .from('otp_verifications')
      .insert({
        email,
        otp_code: otpCode,
        purpose,
        user_id: user_id || null,
        expires_at: expiresAt,
      });

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error('Failed to store OTP');
    }

    console.log('OTP stored in database successfully');

    // Initialize SMTP client for Amazon SES
    const client = new SMTPClient({
      connection: {
        hostname: "email-smtp.ap-south-1.amazonaws.com",
        port: 587,
        tls: true,
        auth: {
          username: "AKIAUA477MZUKWDTENV3",
          password: "BO52KMeYKx4EwbhX5qEsu2DXhIHFpp2mNyiFU+5hO16x",
        },
      },
    });

    console.log('Sending email via Amazon SES...', { to: email, subject: getSubjectByPurpose(purpose) });

    // Send email using Amazon SES SMTP
    await client.send({
      from: "auth-noreply@ticketooz.com",
      to: email,
      subject: getSubjectByPurpose(purpose),
      content: getEmailTemplate(otpCode, purpose),
      html: getEmailTemplate(otpCode, purpose),
    });

    await client.close();

    console.log('Email sent successfully via Amazon SES');

    return new Response(
      JSON.stringify({ success: true, message: 'OTP sent successfully' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );

  } catch (error: any) {
    console.error('Error in send-otp function:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to send OTP' 
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
};

function getSubjectByPurpose(purpose: string): string {
  switch (purpose) {
    case 'registration':
      return 'Verify Your Email - Ticketooz';
    case 'password_reset':
      return 'Reset Your Password - Ticketooz';
    case 'email_change':
      return 'Verify Your New Email - Ticketooz';
    default:
      return 'Verification Code - Ticketooz';
  }
}

function getEmailTemplate(otpCode: string, purpose: string): string {
  const purposeText = purpose === 'registration' 
    ? 'complete your registration' 
    : purpose === 'password_reset' 
    ? 'reset your password'
    : 'verify your email change';

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #4F46E5; font-size: 28px; margin: 0;">Ticketooz</h1>
      </div>
      
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 10px; padding: 30px; text-align: center; color: white; margin-bottom: 30px;">
        <h2 style="margin: 0 0 15px 0; font-size: 24px;">Verification Code</h2>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; margin: 20px 0;">${otpCode}</div>
        <p style="margin: 15px 0 0 0; opacity: 0.9;">Use this code to ${purposeText}</p>
      </div>
      
      <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <p style="margin: 0; color: #666; font-size: 14px;">
          <strong>Security Note:</strong> This code will expire in 10 minutes. If you didn't request this verification, please ignore this email.
        </p>
      </div>
      
      <div style="text-align: center; color: #666; font-size: 12px;">
        <p>© 2024 Ticketooz. All rights reserved.</p>
      </div>
    </div>
  `;
}

serve(handler);
