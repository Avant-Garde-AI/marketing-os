/**
 * Demo Store - Minimal Theme JavaScript
 */

(function() {
  'use strict';

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    console.log('Demo Store theme initialized');

    // Initialize cart functionality
    initCart();

    // Initialize product cards
    initProductCards();

    // Initialize newsletter form
    initNewsletterForm();
  }

  /**
   * Cart functionality
   */
  function initCart() {
    // Add to cart buttons
    const addToCartButtons = document.querySelectorAll('[data-add-to-cart]');

    addToCartButtons.forEach(button => {
      button.addEventListener('click', handleAddToCart);
    });
  }

  function handleAddToCart(event) {
    event.preventDefault();

    const button = event.currentTarget;
    const form = button.closest('form');

    if (!form) return;

    const formData = new FormData(form);

    fetch('/cart/add.js', {
      method: 'POST',
      body: formData
    })
    .then(response => response.json())
    .then(data => {
      console.log('Added to cart:', data);
      updateCartCount();
    })
    .catch(error => {
      console.error('Error adding to cart:', error);
    });
  }

  function updateCartCount() {
    fetch('/cart.js')
      .then(response => response.json())
      .then(cart => {
        const cartCountElements = document.querySelectorAll('[data-cart-count]');
        cartCountElements.forEach(element => {
          element.textContent = cart.item_count;
        });
      })
      .catch(error => {
        console.error('Error updating cart count:', error);
      });
  }

  /**
   * Product cards interactivity
   */
  function initProductCards() {
    const productCards = document.querySelectorAll('.product-card');

    productCards.forEach(card => {
      card.addEventListener('mouseenter', handleProductCardHover);
      card.addEventListener('mouseleave', handleProductCardLeave);
    });
  }

  function handleProductCardHover(event) {
    const card = event.currentTarget;
    card.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
  }

  function handleProductCardLeave(event) {
    const card = event.currentTarget;
    card.style.boxShadow = '';
  }

  /**
   * Newsletter form handling
   */
  function initNewsletterForm() {
    const newsletterForms = document.querySelectorAll('[action*="contact"]');

    newsletterForms.forEach(form => {
      if (form.querySelector('[name="contact[tags]"][value="newsletter"]')) {
        form.addEventListener('submit', handleNewsletterSubmit);
      }
    });
  }

  function handleNewsletterSubmit(event) {
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Subscribing...';

      // Re-enable after form submission
      setTimeout(() => {
        submitButton.disabled = false;
        submitButton.textContent = 'Subscribe';
      }, 2000);
    }
  }

  /**
   * Utility: Debounce function
   */
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Accessibility: Trap focus in modals
   */
  function trapFocus(element) {
    const focusableElements = element.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    element.addEventListener('keydown', function(e) {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    });
  }

  // Export utilities to global scope if needed
  window.ThemeUtils = {
    debounce,
    trapFocus,
    updateCartCount
  };

})();
