#include <gtest/gtest.h>

// This does not (yet) work, see:
// https://github.com/google/googletest/issues/2129

// template <typename T>
// class TypedTestWithParam : public testing::TestWithParam<bool>
// {
// };

// TYPED_TEST_SUITE_P(TypedTestWithParam);

// TYPED_TEST_P(TypedTestWithParam, ExpectsTrue)
// {
//     EXPECT_TRUE(GetParam());
// }

// TYPED_TEST_P(TypedTestWithParam, ExpectsFalse)
// {
//     EXPECT_FALSE(GetParam());
// }

// REGISTER_TYPED_TEST_SUITE_P(TypedTestWithParam, ExpectsTrue, ExpectsFalse);

// using MyTypes = ::testing::Types<char, int, unsigned int>;
// INSTANTIATE_TYPED_TEST_SUITE_P(InstanceP, TypedTestWithParam, MyTypes);

// using MyOtherTypes = ::testing::Types<float, double>;
// INSTANTIATE_TYPED_TEST_SUITE_P(OtherInstanceP, TypedTestWithParam, MyOtherTypes);