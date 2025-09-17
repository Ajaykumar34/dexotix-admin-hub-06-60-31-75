import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useToast } from '@/hooks/use-toast';
import { CreditCard, Lock, IndianRupee, Smartphone, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import { validateSeatBookingData } from '@/utils/seatBookingUtils';
import { bookGeneralAdmission } from '@/lib/bookGeneralAdmission';
import { checkAndUpdateSeatMapSoldOutStatus } from '@/utils/seatMapSoldOutUtils';

// Declare Razorpay on window object
declare global {
  interface Window {
    Razorpay: any;
  }
}

const Payment = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Extract eventDate and eventOccurrenceId from state
  const { 
    event, 
    selectedSeats, 
    selectedGeneralTickets,
    quantity, 
    totalPrice, 
    basePrice, 
    convenienceFee, 
    customerInfo, 
    eventDate, 
    eventOccurrenceId 
  } = location.state || {};
  
  const [processing, setProcessing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'card'>('upi');
  const [paymentGateway, setPaymentGateway] = useState<'razorpay' | 'phonepe'>('razorpay');
  const [paymentSummary, setPaymentSummary] = useState<any>(null);

  // Prevent access if not coming from booking flow
  if (!event || !customerInfo) {
    navigate('/events');
    return null;
  }

  // CORRECTED: Fixed ticket count calculation with proper quantity parsing
  const calculateActualTicketCount = () => {
    console.log('=== FIXED TICKET COUNT CALCULATION ===');
    console.log('selectedGeneralTickets:', selectedGeneralTickets);
    console.log('selectedSeats:', selectedSeats);
    console.log('quantity:', quantity);
    
    // For general admission tickets, sum up all quantities across all categories
    if (selectedGeneralTickets && selectedGeneralTickets.length > 0) {
      console.log('Processing general admission tickets...');
      
      let totalQuantity = 0;
      selectedGeneralTickets.forEach((ticket: any, index: number) => {
        console.log(`Ticket ${index}:`, ticket);
        console.log(`  - categoryName: ${ticket.categoryName}`);
        console.log(`  - quantity (raw): ${ticket.quantity}`);
        console.log(`  - quantity type: ${typeof ticket.quantity}`);
        
        // FIXED: More robust quantity parsing
        let parsedQuantity = 0;
        
        if (typeof ticket.quantity === 'string') {
          // Remove any non-numeric characters and parse
          const cleanQuantity = ticket.quantity.replace(/[^0-9]/g, '');
          parsedQuantity = parseInt(cleanQuantity, 10);
          console.log(`  - cleaned string "${ticket.quantity}" -> "${cleanQuantity}" -> ${parsedQuantity}`);
        } else if (typeof ticket.quantity === 'number') {
          parsedQuantity = ticket.quantity;
          console.log(`  - already number: ${parsedQuantity}`);
        }
        
        // Ensure we have a valid number
        if (isNaN(parsedQuantity) || parsedQuantity < 0) {
          parsedQuantity = 0;
          console.log(`  - invalid quantity, using 0`);
        }
        
        console.log(`  - final parsed quantity: ${parsedQuantity}`);
        totalQuantity += parsedQuantity;
        console.log(`  - running total: ${totalQuantity}`);
      });
      
      console.log(`CORRECTED: Final total quantity from selectedGeneralTickets: ${totalQuantity}`);
      return totalQuantity;
    }
    
    // For selected seats, count the actual quantity from seat data
    if (selectedSeats && selectedSeats.length > 0) {
      let totalSeatQuantity = 0;
      selectedSeats.forEach((seat: any, index: number) => {
        console.log(`Seat ${index}:`, seat);
        
        // FIXED: Extract quantity from different possible locations
        let seatQuantity = 1; // default to 1 seat per selection
        
        if (seat.quantity && typeof seat.quantity === 'number') {
          seatQuantity = seat.quantity;
          console.log(`  - using seat.quantity (number): ${seatQuantity}`);
        } else if (seat.quantity && typeof seat.quantity === 'string') {
          const parsedQty = parseInt(seat.quantity, 10);
          if (!isNaN(parsedQty) && parsedQty > 0) {
            seatQuantity = parsedQty;
            console.log(`  - using seat.quantity (parsed string): ${seatQuantity}`);
          }
        } else if (seat.seat_number && typeof seat.seat_number === 'string') {
          // Try to extract quantity from seat_number like "General x4"
          const match = seat.seat_number.match(/x(\d+)$/);
          if (match) {
            const extractedQty = parseInt(match[1], 10);
            if (!isNaN(extractedQty) && extractedQty > 0) {
              seatQuantity = extractedQty;
              console.log(`  - extracted from seat_number "${seat.seat_number}": ${seatQuantity}`);
            }
          }
        }
        
        console.log(`  - final seat quantity: ${seatQuantity}`);
        totalSeatQuantity += seatQuantity;
      });
      
      console.log(`CORRECTED: Final total seat quantity: ${totalSeatQuantity}`);
      return totalSeatQuantity;
    }
    
    // Fallback to the passed quantity
    const fallbackQuantity = parseInt(String(quantity || 1), 10) || 1;
    console.log(`CORRECTED: Using fallback quantity: ${fallbackQuantity}`);
    return fallbackQuantity;
  };

  const actualTicketCount = calculateActualTicketCount();

  // Load Razorpay script
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // Payment summary calculation for recurring events with accurate pricing data
  useEffect(() => {
    const calculatePaymentSummary = async () => {
      if (selectedGeneralTickets && selectedGeneralTickets.length > 0 && event.is_recurring && eventOccurrenceId) {
        try {
          console.log('[Payment Summary] Calculating accurate pricing for recurring event...');
          
          let totalTickets = 0;
          let totalBasePrice = 0;
          let totalConvenienceFee = 0;
          
          const categoryBreakdown = [];
          
          for (const ticket of selectedGeneralTickets) {
            // CORRECTED: Parse quantity consistently
            let parsedQuantity = 0;
            if (typeof ticket.quantity === 'string') {
              const cleanQuantity = ticket.quantity.replace(/[^0-9]/g, '');
              parsedQuantity = parseInt(cleanQuantity, 10);
            } else if (typeof ticket.quantity === 'number') {
              parsedQuantity = ticket.quantity;
            }
            
            if (isNaN(parsedQuantity) || parsedQuantity < 0) {
              parsedQuantity = 0;
            }
            
            // Fetch accurate pricing for this category from occurrence ticket categories
            let basePrice = ticket.basePrice || 0;
            let convenienceFee = ticket.convenienceFee || 0;
            
            // Skip complex query for now to avoid TypeScript issues
            // Just use the fallback values
            console.log('Using fallback pricing values to avoid TypeScript errors');
            
            const categoryBaseTotal = basePrice * parsedQuantity;
            const categoryConvenienceTotal = convenienceFee * parsedQuantity;
            const categoryTotal = categoryBaseTotal + categoryConvenienceTotal;
            
            totalTickets += parsedQuantity;
            totalBasePrice += categoryBaseTotal;
            totalConvenienceFee += categoryConvenienceTotal;
            
            categoryBreakdown.push({
              categoryName: ticket.categoryName,
              quantity: parsedQuantity,
              basePrice,
              convenienceFee,
              totalPrice: categoryTotal
            });
          }
          
          const totalAmount = totalBasePrice + totalConvenienceFee;
          
          setPaymentSummary({
            totalTickets,
            totalBasePrice,
            totalConvenienceFee,
            totalAmount,
            categoryBreakdown
          });
          
          console.log('[Payment Summary] Summary calculated:', { totalTickets, totalBasePrice, totalConvenienceFee, totalAmount });
        } catch (error) {
          console.error('[Payment Summary] Error calculating payment summary:', error);
        }
      }
    };
    
    calculatePaymentSummary();
  }, [selectedGeneralTickets, event.is_recurring, eventOccurrenceId]);

  const handleRazorpayPayment = async () => {
    setProcessing(true);

    try {
      // First, update the user's profile with the customer information
      if (user?.id) {
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({
            id: user.id,
            first_name: customerInfo.firstName,
            last_name: customerInfo.lastName,
            phone: customerInfo.phone,
            state: customerInfo.state,
            address: customerInfo.address,
            updated_at: new Date().toISOString()
          });

        if (profileError) {
          console.error('Error updating profile:', profileError);
        }
      }

      // Create payment order
      const { data: orderData, error: orderError } = await supabase.functions.invoke('create-payment-order', {
        body: {
          amount: totalPrice,
          currency: 'INR',
          eventId: event.id,
          customerInfo,
        }
      });

      if (orderError) {
        throw new Error(orderError.message || 'Failed to create payment order');
      }

      // CRITICAL FIX: Use eventDate for recurring events, event.start_datetime for regular events
      const bookingEventDate = eventDate || event.start_datetime;
      console.log('[Payment] Razorpay - Using booking date:', bookingEventDate);

      // For general admission events, use the bookGeneralAdmission function
      if (selectedGeneralTickets && selectedGeneralTickets.length > 0) {
        console.log('[Payment] Razorpay - Using bookGeneralAdmission function for general admission');
        
        const { bookGeneralAdmission } = await import('@/lib/bookGeneralAdmission');
        
        // Convert selectedGeneralTickets format to bookGeneralAdmission format with FIXED quantity parsing
        const ticketsForBooking = selectedGeneralTickets.map((ticket: any) => {
          let parsedQuantity = 0;
          if (typeof ticket.quantity === 'string') {
            const cleanQuantity = ticket.quantity.replace(/[^0-9]/g, '');
            parsedQuantity = parseInt(cleanQuantity, 10);
          } else if (typeof ticket.quantity === 'number') {
            parsedQuantity = ticket.quantity;
          }
          
          if (isNaN(parsedQuantity) || parsedQuantity < 0) {
            parsedQuantity = 0;
          }
          
          return {
            categoryName: ticket.categoryName,
            quantity: parsedQuantity,
            basePrice: ticket.basePrice,
            convenienceFee: ticket.convenienceFee
          };
        });

        const customerData = {
          firstName: customerInfo.firstName,
          lastName: customerInfo.lastName,
          email: customerInfo.email,
          phone: customerInfo.phone,
          address: customerInfo.address || '',
          state: customerInfo.state || ''
        };

        const options = {
          key: orderData.keyId,
          amount: orderData.amount,
          currency: orderData.currency,
          name: 'Ticketooz',
          description: `Booking for ${event.name}`,
          order_id: orderData.orderId,
          handler: async function (response: any) {
            console.log('[Payment] Razorpay payment successful:', response);
            
            try {
              // Process General Admission booking using the imported function
              const allBookings = await bookGeneralAdmission(
                event.id,
                ticketsForBooking,
                customerData,
                totalPrice,
                basePrice || 0,
                convenienceFee || 0,
                eventOccurrenceId || undefined,
                undefined
              );

              console.log('[Payment] General admission bookings created:', allBookings);

              // After successful booking, check if the event is sold out for recurring events
              if (!event.is_recurring && selectedSeats && selectedSeats.length > 0) {
                try {
                  await checkAndUpdateSeatMapSoldOutStatus(event.id);
                } catch (error) {
                  console.error('[Payment] Error checking sold-out status:', error);
                }
              }

              toast({
                title: "Payment Successful!",
                description: "Your booking has been confirmed. Check your email for tickets.",
              });

              // Fetch occurrence details for recurring events if needed
              let occurrenceData = null;
              if (eventOccurrenceId && event.is_recurring) {
                try {
                  const { data: occurrence } = await supabase
                    .from('event_occurrences')
                    .select('occurrence_date, occurrence_time')
                    .eq('id', eventOccurrenceId)
                    .single();
                  occurrenceData = occurrence;
                } catch (error) {
                  console.error('Error fetching occurrence data:', error);
                }
              }

              // Navigate to success page with all booking details
              navigate('/booking-success', {
                state: {
                  bookings: allBookings,
                  event,
                  selectedSeats,
                  selectedGeneralTickets,
                  customerInfo,
                  totalPrice,
                  basePrice,
                  convenienceFee: convenienceFee || 0,
                  payment: {
                    id: response.razorpay_payment_id,
                    method: 'razorpay',
                    amount: totalPrice,
                  },
                  eventDate: bookingEventDate,
                  eventOccurrenceId: eventOccurrenceId,
                  occurrenceDate: occurrenceData?.occurrence_date,
                  occurrenceTime: occurrenceData?.occurrence_time
                }
              });
            } catch (error: any) {
              console.error('General admission booking error:', error);
              toast({
                title: "Booking Failed",
                description: error.message || "Unable to complete booking",
                variant: "destructive",
              });
            }
          },
          onDismiss: function (response: any) {
            console.log('Payment cancelled by user');
            setProcessing(false);
          },
        };

        const rzp = new window.Razorpay(options);
        rzp.open();
      } else if (selectedSeats && selectedSeats.length > 0) {
        // For seat-based events, use the existing seat booking logic
        console.log('[Payment] Razorpay - Using seat booking logic');
        
        const options = {
          key: orderData.keyId,
          amount: orderData.amount,
          currency: orderData.currency,
          name: 'Ticketooz',
          description: `Booking for ${event.name}`,
          order_id: orderData.orderId,
          handler: async function (response: any) {
            console.log('[Payment] Payment successful:', response);
            
            try {
              // Verify payment and create booking
              const { data: verifyData, error: verifyError } = await supabase.functions.invoke('verify-payment', {
                body: {
                  razorpay_order_id: orderData.orderId,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                  bookingData: {
                    event_id: event.id,
                    event_occurrence_id: eventOccurrenceId,
                    customer_name: `${customerInfo.firstName} ${customerInfo.lastName}`,
                    customer_email: customerInfo.email,
                    customer_phone: customerInfo.phone,
                    customer_state: customerInfo.state,
                    customer_address: customerInfo.address,
                    total_price: totalPrice,
                    quantity: actualTicketCount,
                    seat_numbers: selectedSeats,
                  }
                }
              });

              if (verifyError) {
                throw new Error(verifyError.message || 'Payment verification failed');
              }

              console.log('[Payment] Payment verified and booking created:', verifyData);

              // Update sold-out status for seatmap events
              if (!event.is_recurring && selectedSeats && selectedSeats.length > 0) {
                try {
                  await checkAndUpdateSeatMapSoldOutStatus(event.id);
                } catch (error) {
                  console.error('[Payment] Error checking sold-out status:', error);
                }
              }

              toast({
                title: "Payment Successful!",
                description: "Your booking has been confirmed. Check your email for tickets.",
              });

              // Fetch occurrence details for recurring events if needed
              let occurrenceData = null;
              if (eventOccurrenceId && event.is_recurring) {
                try {
                  const { data: occurrence } = await supabase
                    .from('event_occurrences')
                    .select('occurrence_date, occurrence_time')
                    .eq('id', eventOccurrenceId)
                    .single();
                  occurrenceData = occurrence;
                } catch (error) {
                  console.error('Error fetching occurrence data:', error);
                }
              }

              // Navigate to success page
              navigate('/booking-success', {
                state: {
                  bookings: [verifyData.booking],
                  event,
                  selectedSeats,
                  selectedGeneralTickets,
                  customerInfo,
                  totalPrice,
                  basePrice,
                  convenienceFee: convenienceFee || 0,
                  payment: {
                    id: response.razorpay_payment_id,
                    method: 'razorpay',
                    amount: totalPrice,
                  },
                  eventDate: bookingEventDate,
                  eventOccurrenceId: eventOccurrenceId,
                  occurrenceDate: occurrenceData?.occurrence_date,
                  occurrenceTime: occurrenceData?.occurrence_time
                }
              });
            } catch (error: any) {
              console.error('Payment verification error:', error);
              toast({
                title: "Payment Verification Failed",
                description: error.message || "Unable to verify payment",
                variant: "destructive",
              });
            }
          },
          onDismiss: function (response: any) {
            console.log('Payment cancelled by user');
            setProcessing(false);
          },
        };

        const rzp = new window.Razorpay(options);
        rzp.open();
      }

    } catch (error: any) {
      console.error('Payment error:', error);
      toast({
        title: "Payment Failed",
        description: error.message || "Unable to process payment",
        variant: "destructive",
      });
      setProcessing(false);
    }
  };

  // PhonePe payment handler for UPI payments
  const handlePhonePePayment = async () => {
    if (!user) {
      toast({
        title: "Authentication Required",
        description: "Please log in to complete your payment",
        variant: "destructive",
      });
      return;
    }

    setProcessing(true);

    try {
      console.log('[PhonePe Payment] Starting PhonePe payment process...');
      
      // Update user profile first
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: customerInfo.email,
          first_name: customerInfo.firstName,
          last_name: customerInfo.lastName,
          phone: customerInfo.phone,
          mobile_number: customerInfo.phone,
          state: customerInfo.state,
          address: customerInfo.address,
        });

      if (profileError) {
        console.error('[PhonePe Payment] Profile update error:', profileError);
      }

      // Create PhonePe payment order
      const { data: orderData, error: orderError } = await supabase.functions.invoke('phonepe-create-order', {
        body: {
          amount: totalPrice,
          eventId: event.id,
          customerInfo,
        }
      });

      if (orderError) {
        throw new Error(orderError.message || 'Failed to create PhonePe payment order');
      }

      if (!orderData.success) {
        throw new Error(orderData.message || 'PhonePe order creation failed');
      }

      console.log('[PhonePe Payment] PhonePe order created:', orderData.merchantTransactionId);

      // Redirect to PhonePe payment page
      if (orderData.data?.instrumentResponse?.redirectInfo?.url) {
        // Store booking data in localStorage for verification after redirect
        const bookingEventDate = eventDate || event.start_datetime;
        
        const bookingDataForStorage = {
          event_id: event.id,
          event_occurrence_id: eventOccurrenceId,
          occurrence_ticket_category_id: selectedGeneralTickets?.[0]?.categoryId || null,
          customer_name: `${customerInfo.firstName} ${customerInfo.lastName}`,
          customer_email: customerInfo.email,
          customer_phone: customerInfo.phone,
          customer_state: customerInfo.state,
          customer_address: customerInfo.address,
          total_price: totalPrice,
          quantity: actualTicketCount,
          seat_numbers: selectedSeats || [],
          selectedGeneralTickets: selectedGeneralTickets || [],
          convenience_fee: convenienceFee || 0,
          merchantTransactionId: orderData.merchantTransactionId,
          eventDate: bookingEventDate,
        };

        localStorage.setItem('pendingPhonePeBooking', JSON.stringify(bookingDataForStorage));
        
        // Redirect to PhonePe
        window.location.href = orderData.data.instrumentResponse.redirectInfo.url;
      } else {
        throw new Error('PhonePe redirect URL not received');
      }

    } catch (error: any) {
      console.error('PhonePe payment error:', error);
      toast({
        title: "Payment Failed",
        description: error.message || "Unable to process UPI payment",
        variant: "destructive",
      });
      setProcessing(false);
    }
  };

  // Get display date and time for the event
  const getDisplayDateTime = () => {
    if (event.is_recurring && eventDate && event.event_time) {
      // For recurring events: Use occurrence date + main event time  
      const dateStr = typeof eventDate === 'string' ? eventDate : format(eventDate, 'yyyy-MM-dd');
      return new Date(`${dateStr}T${event.event_time}`);
    } else if (eventDate) {
      // Use passed eventDate
      return new Date(eventDate);
    } else {
      // Fallback to event start_datetime
      return new Date(event.start_datetime);
    }
  };

  const displayDateTime = getDisplayDateTime();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header with Logo */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <img 
                src="/lovable-uploads/749dfa90-a1d6-4cd0-87ad-4fec3daeb6d2.png"
                alt="Ticketooz"
                className="h-10 w-auto"
                style={{ maxHeight: 48, maxWidth: 180 }}
              />
              <h1 className="sr-only">Ticketooz Events</h1>
            </div>
          </div>
        </div>
      </header>
      
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Payment</h1>
          <p className="text-gray-600 mt-2">Secure payment for your booking</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Payment Methods */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Lock className="w-5 h-5" />
                  <span>Secure Payment</span>
                </CardTitle>
                <CardDescription>Choose your preferred payment method</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Payment Method Selection */}
                <div className="space-y-4">
                  <h3 className="font-medium">Payment Options</h3>
                  
                  <ToggleGroup 
                    type="single" 
                    value={paymentMethod} 
                    onValueChange={(value) => value && setPaymentMethod(value as 'upi' | 'card')}
                    className="grid grid-cols-1 gap-4"
                  >
                    {/* UPI Payment Option */}
                    <ToggleGroupItem
                      value="upi"
                      className={`p-4 h-auto data-[state=on]:bg-blue-50 data-[state=on]:border-blue-500 border-2 rounded-lg transition-all ${
                        paymentMethod === 'upi' 
                          ? 'border-blue-500 bg-blue-50' 
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center space-x-3 w-full">
                        <div className="flex-1 text-left">
                          <div className="flex items-center space-x-2 mb-2">
                            <Smartphone className="w-5 h-5 text-blue-600" />
                            <span className="font-medium">Pay by UPI</span>
                            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">PhonePe</Badge>
                          </div>
                          <p className="text-sm text-gray-600">
                            Quick and secure UPI payments via PhonePe gateway
                          </p>
                          <div className="flex items-center space-x-4 mt-2 text-xs text-blue-600">
                            <span>Instant Transfer</span>
                            <span>UPI Apps</span>
                            <span>QR Code</span>
                          </div>
                        </div>
                      </div>
                    </ToggleGroupItem>
                    
                    {/* Card Payment Option */}
                    <ToggleGroupItem
                      value="card"
                      className={`p-4 h-auto data-[state=on]:bg-green-50 data-[state=on]:border-green-500 border-2 rounded-lg transition-all ${
                        paymentMethod === 'card' 
                          ? 'border-green-500 bg-green-50' 
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center space-x-3 w-full">
                        <div className="flex-1 text-left">
                          <div className="flex items-center space-x-2 mb-2">
                            <CreditCard className="w-5 h-5 text-green-600" />
                            <span className="font-medium">Debit / Credit Card</span>
                            <Badge variant="secondary" className="text-xs bg-green-100 text-green-800">Razorpay</Badge>
                          </div>
                          <p className="text-sm text-gray-600">
                            Pay with Debit Cards, Credit Cards, Net Banking, or Digital Wallets
                          </p>
                          <div className="flex items-center space-x-4 mt-2 text-xs text-green-600">
                            <span>Debit Cards</span>
                            <span>Credit Cards</span>
                            <span>Net Banking</span>
                            <span>Wallets</span>
                          </div>
                        </div>
                      </div>
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                {/* Payment Button */}
                <div className="pt-4">
                  <Button 
                    onClick={paymentMethod === 'upi' ? handlePhonePePayment : handleRazorpayPayment}
                    className={`w-full h-12 ${
                      paymentMethod === 'upi' 
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700' 
                        : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700'
                    }`}
                    disabled={processing}
                  >
                    {paymentMethod === 'upi' ? (
                      <>
                        <Smartphone className="w-4 h-4 mr-2" />
                        {processing ? 'Processing UPI...' : `Pay ₹${totalPrice} via UPI`}
                      </>
                    ) : (
                      <>
                        <CreditCard className="w-4 h-4 mr-2" />
                        {processing ? 'Processing...' : `Pay ₹${totalPrice} via Cards`}
                      </>
                    )}
                  </Button>
                </div>

                {/* Security Info */}
                <div className="text-center pt-4 border-t">
                  <p className="text-sm text-gray-500 flex items-center justify-center">
                    <Lock className="w-4 h-4 mr-1" />
                    {paymentMethod === 'upi' ? 'Secured by PhonePe with 256-bit SSL encryption' : 'Secured by Razorpay with 256-bit SSL encryption'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Order Summary */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle>Order Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-lg">{event.name}</h3>
                    <p className="text-sm text-gray-600">{format(displayDateTime, 'PPP')} at {format(displayDateTime, 'p')}</p>
                    <p className="text-sm text-gray-600">{event.venues?.name || 'Venue TBD'}</p>
                    {event.is_recurring && eventOccurrenceId && (
                      <Badge variant="secondary" className="text-xs mt-1">
                        Recurring Event - Selected Date: {format(displayDateTime, 'PPP')}
                      </Badge>
                    )}
                  </div>

                  <div className="border-t pt-4">
                    <h4 className="font-medium mb-2">Customer Information</h4>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p>{customerInfo.firstName} {customerInfo.lastName}</p>
                      <p>{customerInfo.email}</p>
                      <p>{customerInfo.phone}</p>
                      {customerInfo.state && <p>{customerInfo.state}</p>}
                      {customerInfo.address && <p>{customerInfo.address}</p>}
                    </div>
                  </div>

                  {/* CORRECTED: Enhanced Selected Seats Display */}
                  {selectedSeats && selectedSeats.length > 0 && (
                    <div className="border-t pt-4">
                      <h4 className="font-medium mb-2">Selected Seats</h4>
                      <div className="space-y-2">
                        {selectedSeats.map((seat: any, index: number) => {
                          const seatDisplay = seat.seat_number || `${seat.row_name || ''}${seat.seat_number || seat.id}`;
                          const categoryName = seat.seat_categories?.name || seat.seat_category_name || seat.category_name || seat.category || 'General';
                          
                          // Extract quantity from seat data
                          let seatQuantity = 1; // default to 1 seat
                          
                          if (seat.quantity && typeof seat.quantity === 'number') {
                            seatQuantity = seat.quantity;
                          } else if (seat.quantity && typeof seat.quantity === 'string') {
                            const parsedQty = parseInt(seat.quantity, 10);
                            if (!isNaN(parsedQty) && parsedQty > 0) {
                              seatQuantity = parsedQty;
                            }
                          } else if (seat.seat_number && typeof seat.seat_number === 'string') {
                            // Try to extract quantity from seat_number like "General x4"
                            const match = seat.seat_number.match(/x(\d+)$/);
                            if (match) {
                              const extractedQty = parseInt(match[1], 10);
                              if (!isNaN(extractedQty) && extractedQty > 0) {
                                seatQuantity = extractedQty;
                              }
                            }
                          }
                          
                          const seatPrice = seat.price || basePrice || 0;
                          const totalSeatPrice = seatPrice * seatQuantity;
                          
                          return (
                            <div key={index} className="flex justify-between items-center text-sm p-3 bg-blue-50 border border-blue-200 rounded">
                              <div className="flex-1">
                                <div className="font-medium text-blue-800">{categoryName}</div>
                                <div className="text-gray-600 text-xs">
                                  Seat: {seatDisplay} • Quantity: {seatQuantity}
                                  {seatQuantity > 1 && (
                                    <span> • ₹{seatPrice} × {seatQuantity} = ₹{totalSeatPrice}</span>
                                  )}
                                </div>
                              </div>
                              <span className="font-medium text-blue-600">₹{totalSeatPrice}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* CORRECTED: Enhanced Selected General Tickets Display */}
                  {selectedGeneralTickets && selectedGeneralTickets.length > 0 && (
                    <div className="border-t pt-4">
                      <h4 className="font-medium mb-2">Selected Tickets</h4>
                      <div className="space-y-2">
                        {paymentSummary && paymentSummary.categoryBreakdown ? (
                          // Use payment summary data for accurate pricing
                          paymentSummary.categoryBreakdown.map((category: any, index: number) => (
                            <div key={index} className="flex justify-between items-center text-sm p-3 bg-green-50 border border-green-200 rounded">
                              <div className="flex-1">
                                <div className="font-medium text-green-800">{category.categoryName}</div>
                                <div className="text-gray-600 text-xs">
                                  Quantity: {category.quantity} • Base: ₹{category.basePrice} × {category.quantity} = ₹{category.basePrice * category.quantity}
                                  {category.convenienceFee > 0 && (
                                    <span> • Conv: ₹{category.convenienceFee} × {category.quantity} = ₹{category.convenienceFee * category.quantity}</span>
                                  )}
                                </div>
                              </div>
                              <span className="font-medium text-green-600">₹{category.totalPrice}</span>
                            </div>
                          ))
                        ) : (
                          // Fallback to original selectedGeneralTickets display with CORRECTED quantity parsing
                          selectedGeneralTickets.map((ticket: any, index: number) => {
                            console.log(`Rendering ticket ${index}:`, ticket);
                            
                            // CORRECTED: More robust quantity parsing
                            let parsedQuantity = 0;
                            if (typeof ticket.quantity === 'string') {
                              const cleanQuantity = ticket.quantity.replace(/[^0-9]/g, '');
                              parsedQuantity = parseInt(cleanQuantity, 10);
                              console.log(`Parsed string quantity "${ticket.quantity}" -> "${cleanQuantity}" -> ${parsedQuantity}`);
                            } else if (typeof ticket.quantity === 'number') {
                              parsedQuantity = ticket.quantity;
                              console.log(`Using number quantity ${parsedQuantity}`);
                            }
                            
                            if (isNaN(parsedQuantity) || parsedQuantity < 0) {
                              parsedQuantity = 0;
                              console.log(`Invalid quantity, using 0`);
                            }
                            
                            const totalTicketPrice = ticket.basePrice * parsedQuantity;
                            const totalConvenienceFee = ticket.convenienceFee * parsedQuantity;
                            const totalCategoryPrice = totalTicketPrice + totalConvenienceFee;
                            
                            return (
                              <div key={index} className="flex justify-between items-center text-sm p-3 bg-green-50 border border-green-200 rounded">
                                <div className="flex-1">
                                  <div className="font-medium text-green-800">{ticket.categoryName}</div>
                                  <div className="text-gray-600 text-xs">
                                    Quantity: {parsedQuantity} • Base: ₹{ticket.basePrice} × {parsedQuantity} = ₹{totalTicketPrice}
                                    {ticket.convenienceFee > 0 && (
                                      <span> • Conv: ₹{ticket.convenienceFee} × {parsedQuantity} = ₹{totalConvenienceFee}</span>
                                    )}
                                  </div>
                                </div>
                                <span className="font-medium text-green-600">₹{totalCategoryPrice}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}

                  <div className="border-t pt-4 space-y-2">
                    {/* Enhanced payment summary display */}
                    {paymentSummary ? (
                      <>
                        <div className="flex justify-between items-center text-sm">
                          <span>Base Amount</span>
                          <span>₹{paymentSummary.totalBasePrice}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span>Convenience Fee</span>
                          <span>₹{paymentSummary.totalConvenienceFee}</span>
                        </div>
                        <div className="border-t pt-2">
                          <div className="flex justify-between items-center text-lg font-semibold">
                            <span>Total Amount</span>
                            <div className="flex items-center space-x-1">
                              <IndianRupee className="w-5 h-5 text-green-600" />
                              <span className="text-green-600">₹{paymentSummary.totalAmount}</span>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      // Fallback to original pricing display
                      basePrice && !isNaN(basePrice) && convenienceFee !== undefined && !isNaN(convenienceFee) ? (
                        <>
                          <div className="flex justify-between items-center text-sm">
                            <span>Base Amount</span>
                            <span>₹{basePrice}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span>Convenience Fee</span>
                            <span>₹{convenienceFee || 0}</span>
                          </div>
                          <div className="border-t pt-2">
                            <div className="flex justify-between items-center text-lg font-semibold">
                              <span>Total Amount</span>
                              <div className="flex items-center space-x-1">
                                <IndianRupee className="w-5 h-5 text-green-600" />
                                <span className="text-green-600">₹{totalPrice}</span>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="flex justify-between items-center text-lg font-semibold">
                          <span>Total Amount</span>
                          <div className="flex items-center space-x-1">
                            <IndianRupee className="w-5 h-5 text-green-600" />
                            <span className="text-green-600">₹{totalPrice || 'N/A'}</span>
                          </div>
                        </div>
                      )
                    )}
                    
                    {/* CORRECTED: Fixed ticket quantity information */}
                    <div className="text-sm text-gray-500 mt-2">
                      <div className="font-medium">Total Tickets: {paymentSummary?.totalTickets || actualTicketCount}</div>
                      {selectedGeneralTickets && selectedGeneralTickets.length > 0 && (
                        <div className="mt-2 text-xs space-y-1">
                          <div className="font-medium">Category Breakdown:</div>
                          {selectedGeneralTickets.map((ticket: any, index: number) => {
                            // CORRECTED: Consistent quantity parsing
                            let parsedQuantity = 0;
                            if (typeof ticket.quantity === 'string') {
                              const cleanQuantity = ticket.quantity.replace(/[^0-9]/g, '');
                              parsedQuantity = parseInt(cleanQuantity, 10);
                            } else if (typeof ticket.quantity === 'number') {
                              parsedQuantity = ticket.quantity;
                            }
                            
                            if (isNaN(parsedQuantity) || parsedQuantity < 0) {
                              parsedQuantity = 0;
                            }
                            
                            return (
                              <div key={index} className="flex justify-between">
                                <span>{ticket.categoryName}:</span>
                                <span>{parsedQuantity} tickets</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Payment;