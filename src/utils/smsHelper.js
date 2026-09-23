import axios from "axios";

/**
 * Sends SMS OTP via Hanu OTP API
 * Endpoint: https://api.hanuotp.in/sms-otp.php?number=mobile_number&OTP=otp&apikey=886ae58d4a682b69c57f1c41e940c4ac&templatesid=default
 * @param {string} phoneNumber - 10-digit mobile number
 * @param {string} otp - 6-digit OTP code
 */
export const sendSMSOTP = async (phoneNumber, otp) => {
  const cleanPhone = (phoneNumber || "").toString().replace(/\D/g, "");
  // Format to 10-digit number (slice last 10 digits if lead with country code like 91)
  const mobileNumber = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;

  if (!mobileNumber || mobileNumber.length < 10) {
    throw new Error("Please enter a valid 10-digit mobile number.");
  }

  const apiKey = process.env.HANU_OTP_API_KEY || "886ae58d4a682b69c57f1c41e940c4ac";
  const url = `https://api.hanuotp.in/sms-otp.php?number=${mobileNumber}&OTP=${otp}&apikey=${apiKey}&templatesid=default`;

  console.log(`[sendSMSOTP] Requesting Hanu OTP for number=${mobileNumber}...`);

  try {
    const response = await axios.get(url, { timeout: 12000 });
    const data = response.data;
    console.log("[sendSMSOTP] Hanu OTP API Response:", data);

    // Hanu OTP error response check: returns status "error" / error field when failing
    if (data && (data.status === "error" || data.status === "Error" || data.status === false || data.error)) {
      const errMsg = data.message || data.error || data.msg || "SMS delivery returned status error from provider.";
      console.error("[sendSMSOTP] Provider error:", errMsg);
      throw new Error(errMsg);
    }

    return data;
  } catch (error) {
    console.error("[sendSMSOTP] Exception sending SMS OTP:", error.message);
    const detailedMsg = error.response?.data?.message || error.message || "Failed to send SMS OTP via Hanu OTP provider.";
    throw new Error(detailedMsg);
  }
};
