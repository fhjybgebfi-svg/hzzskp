alert("JAVASCRIPT HIDUP BANG!");
document.getElementById('goToRegister').onclick = (e) => { 
  e.preventDefault(); 
  document.getElementById('loginForm').style.display='none'; 
  document.getElementById('registerForm').style.display='block'; 
};
document.getElementById('goToLogin').onclick = (e) => { 
  e.preventDefault(); 
  document.getElementById('registerForm').style.display='none'; 
  document.getElementById('loginForm').style.display='block'; 
};
document.getElementById('btnGuest').onclick = () => window.location.href = 'main.html';
