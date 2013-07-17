define('buttons',
    ['apps', 'cache', 'capabilities', 'defer', 'l10n', 'log', 'login', 'models', 'notification', 'payments/payments', 'requests', 'settings', 'tracking', 'urls', 'user', 'utils', 'views', 'z'],
    function(apps, cache, caps, defer, l10n, log, login, models, notification, payments, requests, settings, tracking, urls, user, utils, views, z) {

    var console = log('buttons');

    var apps_model = models('app');
    var gettext = l10n.gettext;

    function setButton($button, text, cls) {
        revertButton($button, text);
        $button.addClass(cls);
    }

    function revertButton($button, text) {
        $button.removeClass('purchasing installing error spinning');
        $button.html(text || $button.data('old-text'));
    }

    function _handler(func) {
        return function(e) {
            e.preventDefault();
            e.stopPropagation();
            func.call(this, apps_model.lookup($(this).closest('[data-slug]').data('slug')));
        };
    }

    var launchHandler = _handler(function(product) {
        z.apps[product.manifest_url].launch();
        tracking.trackEvent(
            'Launch app',
            product.payment_required ? 'Paid' : 'Free',
            product.slug
        );
    });

    function install(product, $button) {
        var product_name = product.name;
        console.log('Install requested for', product_name);

        // If it's a paid app, ask the user to sign in first.
        if (product.payment_required && !user.logged_in()) {
            console.log('Install suspended; user needs to log in');
            return login.login().done(function() {
                // Once login completes, just call this function again with
                // the same parameters.
                install(product, $button);
            }).fail(function(){
                console.log('Install cancelled; login aborted');
                notification.notification({message: gettext('Payment cancelled')});
            });
        }

        // If there isn't a user object on the app, add one.
        if (!product.user) {
            console.warn('User data not available for', product_name);
            product.user = {
                purchased: false,
                installed: false,
                developed: false
            };
        }

        // Create a master deferred for the button action.
        var def = defer.Deferred();
        // Create a reference to the button.
        var $this = $button || $(this);
        var _timeout;

        // TODO: Have the API possibly return this (bug 889501).
        product.receipt_required = (product.premium_type != 'free' &&
                                    product.premium_type != 'free-inapp' &&
                                    !settings.simulate_nav_pay);

        // If the user has already purchased the app, we do need to generate
        // another receipt but we don't need to go through the purchase flow again.
        if (product.user.purchased) {
            product.payment_required = false;
        }

        if (product.payment_required) {
            // The app requires a payment.

            console.log('Starting payment flow for', product_name);
            setButton($this, gettext('Purchasing'), 'purchasing');
            payments.purchase(product).then(function() {
                console.log('Purchase flow completed for', product_name);

                // Update the button to say Install. It's going to get
                // overwritten in a second, but this sets the old-text as well.
                setButton($this, gettext('Install'), 'purchased');

                // Update the cache to show that the app was purchased.
                product.user.purchased = true;

                // Bust the cache for the My Apps page.
                cache.bust(urls.api.url('installed'));
                // Rewrite the cache to allow the user to review the app.
                cache.attemptRewrite(function(key) {
                    return key === urls.api.params('reviews', {app: product.slug});
                }, function(data) {
                    data.user.can_rate = true;
                    return data;
                });
                // Reload the view to reflect the changes.
                views.reload();

                // Start the app's installation.
                start_install()
            }, function() {
                console.log('Purchase flow rejected for', product_name);
                def.reject();
            });

        } else {
            // There's no payment required, just start install.

            console.log('Starting app installation for', product_name);
            // Start the app's installation.
            start_install();
        }

        function start_install() {

            // Track that an install was started.
            tracking.trackEvent(
                'Click to install app',
                product.receipt_required ? 'paid' : 'free',
                product_name + ':' + product.id,
                $('.button.product').index($this)
            );

            // Make the button a spinner.
            $this.data('old-text', $this.html())
                 .html('<span class="spin"></span>')
                 .addClass('spinning');
            // Reset button if it's been 30 seconds without user action.
            _timeout = setTimeout(function() {
                if ($this.hasClass('spinning')) {
                    console.warn('Spinner timeout for', product_name);
                    revertButton($this);
                }
            }, 30000);

            // If the app has already been installed by the user and we don't
            // need a receipt, just start the app install.
            if (product.user.installed || !product.receipt_required) {
                console.log('Receipt not required (skipping record step) for', product_name);
                return do_install();
            }

            // Let the API know we're installing.
            return requests.post(
                urls.api.url('record_' + (product.receipt_required ? 'paid' : 'free')),
                {app: product.id, chromeless: +caps.chromeless}
            ).done(function(response) {
                // If the server returned an error, log it and reject the deferred.
                if (response.error) {
                    console.log('Server returned error: ' + response.error);
                    def.reject();
                    return;
                }

                do_install({data: {'receipts': [response.receipt]}});
                
            }).fail(function() {
                // Could not record/generate receipt!
                console.error('Could not generate receipt or record install for', product_name);
                def.reject();
            });
        }

        function do_install(data) {
            apps.install(product, data || {}).done(function(installer) {
                // Update the cache to show that the user installed the app.
                product.user.installed = true;
                // Bust the cache for the My Apps page.
                cache.bust(urls.api.url('installed'));

                def.resolve(installer, product, $this);
            }).fail(function() {
                console.log('App install deferred was rejected for ', product.name);
                def.reject();
            });
        }

        // After everything has completed...
        def.then(function(installer) {
            // On install success, carry out post-install logic.

            // Clear the spinner timeout if one was set.
            if (_timeout) {
                clearTimeout(_timeout);
            }

            // Show the box on how to run the app.
            var $installed = $('#installed');
            var $how = $installed.find('.' + utils.browser());
            if ($how.length) {
                $installed.show();
                $how.show();
            }

            // Track that the install was successful.
            tracking.trackEvent(
                'Successful app install',
                product.receipt_required ? 'paid' : 'free',
                product_name + ':' + product.id,
                $('.button.product').index($button)
            );

            buttonInstalled(product.manifest_url, installer, $this);

            console.log('Successful install for', product_name);
            
        }, function() {
            // L10n: The app's installation has failed, but the problem is temporary.
            notification.notification({
                message: gettext('Install failed. Please try again later.')
            });

            // If the purchase or installation fails, revert the button.
            revertButton($this);
            console.log('Unsuccessful install for', product_name);
        });

        return def.promise();
    }

    z.page.on('click', '.product.launch', launchHandler)
          .on('click', '.button.product:not(.launch):not(.incompatible)', _handler(install));

    function buttonInstalled(manifest_url, installer, $button) {
        // If the button wasn't passed, look it up.
        if (!$button || !$button.length) {
            $button = $('.button[data-manifest_url="' + manifest_url.replace(/"/, '\\"') + '"]');
            if (!$button.length) {
                return;
            }
        }
        z.apps[manifest_url] = installer;

        // L10n: "Launch" as in "Launch the app"
        setButton($button, gettext('Launch'), 'launch install');
    }

    return {
        buttonInstalled: buttonInstalled,
        install: install
    };
});
