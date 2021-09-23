#include <gtest/gtest.h>

template <typename T>
class TypedTest : public testing::Test
{
};

using MyTypes = ::testing::Types<char, int, unsigned int>;
TYPED_TEST_SUITE(TypedTest, MyTypes);

TYPED_TEST(TypedTest, DoesBlah)
{
    SUCCEED();
}

TYPED_TEST(TypedTest, HasPropertyA)
{
    SUCCEED();
}
