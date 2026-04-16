const Joi = require('joi');

const string_schema = Joi.string();
const float_schema = Joi.number();
const int_schema = Joi.number().integer();
const bool_schema = Joi.boolean();
const string_alphanum_schema = Joi.string().alphanum();
const string_array_schema = Joi.array().items(Joi.string());

function validate(v, s){
	const { error, value } = s.validate(v);
	if (!error) return value;
    console.error('Validation failed:', error.details[0].message);
    return false;
}

exports.TYPE_STRING = (v) => validate(v, string_schema);
exports.TYPE_STRING_ALPHANUM = (v) => validate(v, string_alphanum_schema);
exports.TYPE_STRING_ARRAY = (v) => validate(v, string_array_schema);
exports.TYPE_BOOL = (v) => validate(v, bool_schema);
exports.TYPE_FLOAT = (v) => validate(v, float_schema);
exports.TYPE_INT = (v) => validate(v, int_schema);