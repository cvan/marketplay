// Desktop tests for feedback modal
var suite = require('./kasperle').suite();

// Desktop only tests.
suite.marionetteSkip = true;

suite.setUp = function(){
    suite.viewport(720, 500);
};

suite.tearDown = function(){
    suite.viewport(400, 300);
};

suite.run('/', function(test, waitFor) {

    waitFor(function() {
        return suite.exists('#splash-overlay.hide');
    });

    test('Clicking on feedback link', function(assert) {
        suite.press('#site-footer .submit-feedback');
    });

    waitFor(function() {
        return suite.visible('.feedback.modal');
    });

    test('Check modal displayed', function(assert) {
        suite.capture('feedback.png');
        assert.visible('.feedback.modal');
        assert.visible('.feedback-form textarea');
        assert.selectorExists('.potato-captcha');
        assert.invisible('.potato-captcha');
        assert.selectorExists('.feedback-form button[disabled]');
        assert.selectorLength(function() {
            return document.querySelectorAll('.feedback.modal').length;
        }, 1, 'Only one feedback modal exists');
    });

    test('Verify form is filled and button is enabled.', function(assert) {
        suite.fill('.feedback-form', {'feedback': 'test'});
        assert.selectorExists('.feedback-form button:not([disabled])');
        suite.press('.feedback-form button');
    });

    waitFor(function() {
        return !suite.visible('.feedback.modal');
    });

    test('Verify form is submitted', function(assert) {
        assert.invisible('.feedback.modal');
    });


});
