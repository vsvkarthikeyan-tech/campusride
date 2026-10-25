// Authentication & Registration Handlers

let registrationEmail = '';

// Check if user is already logged in
function checkAuthSession() {
  const token = localStorage.getItem('saitrack_token') || sessionStorage.getItem('saitrack_token');
  const userStr = localStorage.getItem('saitrack_user') || sessionStorage.getItem('saitrack_user');
  
  if (token && userStr) {
    try {
      const user = JSON.parse(userStr);
      globalState.token = token;
      globalState.user = user;
      
      // Update UI Header
      showUserHeader(user);
      
      // Route to correct dashboard
      routeToView(user.role);
      
      // Initialize WebSocket
      initWebSocket();
      return true;
    } catch (e) {
      clearAuthSession();
    }
  }
  return false;
}

function showUserHeader(user) {
  const headerDiv = document.getElementById('nav-user-profile');
  const badgeSpan = document.getElementById('nav-user-badge');
  const nameSpan = document.getElementById('nav-user-name');
  
  badgeSpan.textContent = user.role;
  nameSpan.textContent = user.name;
  headerDiv.style.display = 'flex';
}

function clearAuthSession() {
  localStorage.removeItem('saitrack_token');
  localStorage.removeItem('saitrack_user');
  sessionStorage.removeItem('saitrack_token');
  sessionStorage.removeItem('saitrack_user');
  
  globalState.token = null;
  globalState.user = null;
  
  document.getElementById('nav-user-profile').style.display = 'none';
}

// Switch Login / Register Tabs
function switchAuthTab(tab) {
  const loginTab = document.getElementById('tab-login');
  const regTab = document.getElementById('tab-register');
  const loginForm = document.getElementById('form-login');
  const regForm = document.getElementById('form-register');
  
  if (tab === 'login') {
    loginTab.classList.add('active');
    regTab.classList.remove('active');
    loginForm.style.display = 'block';
    regForm.style.display = 'none';
  } else {
    loginTab.classList.remove('active');
    regTab.classList.add('active');
    loginForm.style.display = 'none';
    regForm.style.display = 'block';
  }
}

// Login Submit Form
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const remember = document.getElementById('remember-me').checked;
  
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    
    // Save state
    globalState.token = data.token;
    globalState.user = data.user;
    
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem('saitrack_token', data.token);
    storage.setItem('saitrack_user', JSON.stringify(data.user));
    
    showUserHeader(data.user);
    routeToView(data.user.role);
    initWebSocket();
    
    // Alert Notification
    showNotification('Sign In', `Logged in successfully as ${data.user.name}`);
  } catch (err) {
    alert(`Authentication Error: ${err.message}`);
  }
});

// Register Submit Form
document.getElementById('form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const name = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const phone = document.getElementById('reg-phone').value;
  const password = document.getElementById('reg-password').value;
  const role = document.getElementById('reg-role').value;
  
  if (!name || !email || !phone || !password) {
    alert('Please fill out all registration fields');
    return;
  }
  
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, password, role })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    
    // Stash email for OTP submission
    registrationEmail = email;
    
    // Open OTP Overlay
    document.getElementById('otp-overlay').classList.add('active');
    
    // Notify user about verification code
    if (data.mock_otp) {
      alert(`Saitrack / CampusRide Test Verification Code: ${data.mock_otp}\n(Notice: Automated testing mode enabled)`);
    } else {
      alert(`Verification code dispatched to +91 ${phone}.\nIn local development mode, please inspect the server terminal console logs.`);
    }
    
    // Start OTP Countdown timer (10 mins)
    startOTPTimer(600);
  } catch (err) {
    alert(`Registration Error: ${err.message}`);
  }
});

// OTP Timer Tracker
let otpInterval;
function startOTPTimer(durationSeconds) {
  let timer = durationSeconds, minutes, seconds;
  const timerDiv = document.getElementById('otp-timer');
  
  clearInterval(otpInterval);
  otpInterval = setInterval(() => {
    minutes = parseInt(timer / 60, 10);
    seconds = parseInt(timer % 60, 10);

    minutes = minutes < 10 ? "0" + minutes : minutes;
    seconds = seconds < 10 ? "0" + seconds : seconds;

    timerDiv.textContent = `Code expires in: ${minutes}:${seconds}`;

    if (--timer < 0) {
      clearInterval(otpInterval);
      timerDiv.textContent = "OTP Expired. Please register again.";
    }
  }, 1000);
}

// Confirm Verify OTP
document.getElementById('btn-verify-otp').addEventListener('click', async () => {
  const code = document.getElementById('otp-code').value;
  if (!code || code.length !== 6) {
    alert('Please enter the 6-digit OTP code');
    return;
  }
  
  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: registrationEmail, code })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'OTP verification failed');
    
    // Success
    alert(data.message);
    document.getElementById('otp-overlay').classList.remove('active');
    clearInterval(otpInterval);
    
    // Reset forms and view
    document.getElementById('form-register').reset();
    switchAuthTab('login');
  } catch (err) {
    alert(`Verification Error: ${err.message}`);
  }
});

// Cancel OTP Modal
document.getElementById('btn-cancel-otp').addEventListener('click', () => {
  document.getElementById('otp-overlay').classList.remove('active');
  clearInterval(otpInterval);
});

// Logout action
document.getElementById('btn-logout').addEventListener('click', () => {
  clearAuthSession();
  if (globalState.socket) {
    globalState.socket.close();
  }
  
  // Show auth page
  routeToView('auth');
});
