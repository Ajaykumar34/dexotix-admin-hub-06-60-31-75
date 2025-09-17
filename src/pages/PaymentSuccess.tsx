import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const PaymentSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [verifying, setVerifying] = useState(true);
  const [paymentStatus, setPaymentStatus] = useState<'success' | 'failed' | 'pending'>('pending');
  const [bookingData, setBookingData] = useState<any>(null);

  useEffect(() => {
    const verifyPayment = async () => {
      try {
        // Get merchant transaction ID from URL params or localStorage
        const merchantTransactionId = searchParams.get('merchantTransactionId') || 
          searchParams.get('transactionId');
        
        // Get stored booking data
        const storedBookingData = localStorage.getItem('pendingPhonePeBooking');
        
        if (!merchantTransactionId && !storedBookingData) {
          console.error('No transaction ID or booking data found');
          setPaymentStatus('failed');
          setVerifying(false);
          return;
        }

        let transactionIdToVerify = merchantTransactionId;
        let bookingDataToVerify = storedBookingData ? JSON.parse(storedBookingData) : null;

        // If no transaction ID from URL, try to get it from stored data
        if (!transactionIdToVerify && bookingDataToVerify?.merchantTransactionId) {
          transactionIdToVerify = bookingDataToVerify.merchantTransactionId;
        }

        if (!transactionIdToVerify) {
          console.error('No transaction ID available for verification');
          setPaymentStatus('failed');
          setVerifying(false);
          return;
        }

        console.log('Verifying PhonePe payment:', transactionIdToVerify);

        // Verify payment with backend
        const { data: verificationResult, error: verificationError } = await supabase.functions.invoke('phonepe-verify-payment', {
          body: {
            merchantTransactionId: transactionIdToVerify,
            bookingData: bookingDataToVerify,
          }
        });

        if (verificationError) {
          console.error('Payment verification error:', verificationError);
          setPaymentStatus('failed');
          toast({
            title: "Payment Verification Failed",
            description: verificationError.message || "Unable to verify payment status",
            variant: "destructive",
          });
        } else if (verificationResult?.success) {
          console.log('Payment verified successfully:', verificationResult);
          setPaymentStatus('success');
          setBookingData(verificationResult.booking);
          
          // Clear stored booking data
          localStorage.removeItem('pendingPhonePeBooking');
          
          toast({
            title: "Payment Successful!",
            description: "Your booking has been confirmed. Check your email for tickets.",
          });

          // Redirect to booking success page after a short delay
          setTimeout(() => {
            navigate('/booking-success', {
              state: {
                booking: verificationResult.booking,
                payment: verificationResult.payment,
                event: bookingDataToVerify?.event,
                customerInfo: {
                  firstName: bookingDataToVerify?.customer_name?.split(' ')[0] || '',
                  lastName: bookingDataToVerify?.customer_name?.split(' ').slice(1).join(' ') || '',
                  email: bookingDataToVerify?.customer_email || '',
                  phone: bookingDataToVerify?.customer_phone || '',
                },
                totalPrice: bookingDataToVerify?.total_price || 0,
                convenienceFee: bookingDataToVerify?.convenience_fee || 0,
                eventDate: bookingDataToVerify?.eventDate,
                selectedSeats: bookingDataToVerify?.seat_numbers || [],
                selectedGeneralTickets: bookingDataToVerify?.selectedGeneralTickets || [],
              }
            });
          }, 2000);
        } else {
          console.error('Payment verification failed:', verificationResult);
          setPaymentStatus('failed');
          toast({
            title: "Payment Failed",
            description: "Payment verification failed. Please contact support if amount was deducted.",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error('Unexpected error during payment verification:', error);
        setPaymentStatus('failed');
        toast({
          title: "Verification Error",
          description: "An unexpected error occurred. Please contact support.",
          variant: "destructive",
        });
      } finally {
        setVerifying(false);
      }
    };

    verifyPayment();
  }, [searchParams, navigate, toast]);

  if (verifying) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <Loader2 className="w-16 h-16 text-blue-600 animate-spin" />
            </div>
            <CardTitle>Verifying Payment</CardTitle>
            <CardDescription>
              Please wait while we verify your payment...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            {paymentStatus === 'success' ? (
              <CheckCircle className="w-16 h-16 text-green-600" />
            ) : (
              <XCircle className="w-16 h-16 text-red-600" />
            )}
          </div>
          <CardTitle>
            {paymentStatus === 'success' ? 'Payment Successful!' : 'Payment Failed'}
          </CardTitle>
          <CardDescription>
            {paymentStatus === 'success' 
              ? 'Your booking has been confirmed. Redirecting to booking details...'
              : 'There was an issue with your payment. Please try again.'
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {paymentStatus === 'failed' && (
            <div className="space-y-4">
              <Button 
                onClick={() => navigate('/events')} 
                variant="outline"
                className="w-full"
              >
                Back to Events
              </Button>
              <p className="text-xs text-gray-500">
                If amount was deducted from your account, please contact our support team.
              </p>
            </div>
          )}
          
          {bookingData && (
            <div className="text-left bg-gray-50 p-4 rounded-lg">
              <h3 className="font-medium mb-2">Booking Details</h3>
              <p className="text-sm text-gray-600">
                Booking ID: {bookingData.formatted_booking_id || bookingData.id}
              </p>
              <p className="text-sm text-gray-600">
                Total Amount: ₹{bookingData.total_price}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentSuccess;